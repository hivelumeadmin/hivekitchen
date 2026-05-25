import type { FastifyBaseLogger } from 'fastify';
import type OpenAI from 'openai';
import { z } from 'zod';
import {
  AllergyGuardrailDecryptError,
  type AllergyGuardrailRepository,
} from '../allergy-guardrail/allergy-guardrail.repository.js';
import {
  evaluate as evaluateGuardrail,
  type AllergyRule,
} from '../allergy-guardrail/allergy-rules.engine.js';
import type { HouseholdsRepository } from '../households/households.repository.js';
import type { KitchenMapService } from '../kitchen-map/kitchen-map.service.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import { catalogItemToPlanItem } from './catalog-guardrail-helper.js';
import {
  buildCatalogSeedPrompt,
  type CatalogSeedSnapshot,
} from '../../agents/prompts/catalog-seed.prompt.js';

// Slice 2.6-s3 — Stage 1 LLM-driven catalog seeding service.
//
// One entry point, fire-and-forget from the caller's perspective:
//   seedForHousehold(householdId, requestId) — invoked by the BullMQ worker
//   when the parent advances OUT of m2_safe.
//
// Pipeline:
//   1. Idempotency on households.stage1_completed_at
//   2. Household snapshot via KitchenMapService
//   3. LLM call (gpt-4o, json_object, 5s AbortSignal)
//   4. Response Zod parse → per-item Zod parse → guardrail filter
//   5. Persist survivors via RecipesRepository.seedFromCatalogBaseline
//   6. Set stage1_completed_at (success path only)
//
// NEVER throws. The job worker treats this as fire-and-forget — any failure
// is logged and stage1_completed_at stays NULL so 2.6-s4's polling window
// elapses and the cold-start fallback runs.

// Confidence for Stage 1 LLM-seeded rows — slightly less trusted than the
// hand-curated baseline's 60.
const STAGE1_CONFIDENCE_SCORE = 50;
// LLM call hard timeout. The brief sets a 5s p95 SLA on the worker; the
// 5000ms AbortSignal keeps the LLM portion bounded.
const STAGE1_LLM_TIMEOUT_MS = 5_000;
const STAGE1_LLM_MODEL = 'gpt-4o';
const STAGE1_LLM_TEMPERATURE = 0.7;
const STAGE1_LLM_MAX_TOKENS = 4_000;
// Below this many validated items, log floor_breach. Stage 1 still persists
// whatever survived; 2.6-s5 will eventually enqueue a recovery job here.
const STAGE1_FLOOR = 10;
// FALCPA category words the LLM MUST not introduce. Tracked alongside the
// household's declared allergens so a peanut household never gets a peanut
// item even if the LLM mis-tags allergen_flags as [].
const FALCPA_KEYS = [
  'peanut',
  'tree_nut',
  'dairy',
  'egg',
  'wheat',
  'soy',
  'fish',
  'shellfish',
  'sesame',
] as const;

// Slice 2.6-s3 — per-item shape emitted by the LLM. Layer 1 only —
// ingredients are populated lazily via RecipeAgent.discover() at plan-commit
// time (Layer 2 trigger in PlansService.materializeBeforeCommit()).
export const CatalogSeedItemSchema = z.object({
  canonical_name: z.string().min(1).max(200),
  allergen_flags: z.array(z.string()),
  dietary_flags: z.array(z.string()),
  cultural_tags: z.array(z.string()),
  cuisine_tags: z.array(z.string()),
  applicable_slots: z.array(z.string()).min(1),
});
export type CatalogSeedItem = z.infer<typeof CatalogSeedItemSchema>;

export const CatalogSeedResponseSchema = z.object({
  items: z.array(CatalogSeedItemSchema),
});

const VALID_SLOTS = new Set(['main', 'snack', 'extra']);
type ValidSlot = 'main' | 'snack' | 'extra';

export interface CatalogSeedServiceDeps {
  openai: OpenAI;
  kitchenMapService: KitchenMapService;
  recipesRepo: RecipesRepository;
  householdsRepo: HouseholdsRepository;
  guardrailRepo: AllergyGuardrailRepository;
  curatedBaselineRepo: {
    findAllActive: () => Promise<
      ReadonlyArray<{
        canonical_name: string;
        allergen_flags: string[];
        dietary_flags: string[];
        cultural_tags: string[];
        cuisine_tags: string[];
        applicable_slots: Array<ValidSlot>;
      }>
    >;
  };
  logger: FastifyBaseLogger;
}

export class CatalogSeedService {
  private readonly openai: OpenAI;
  private readonly kitchenMapService: KitchenMapService;
  private readonly recipesRepo: RecipesRepository;
  private readonly householdsRepo: HouseholdsRepository;
  private readonly guardrailRepo: AllergyGuardrailRepository;
  private readonly curatedBaselineRepo: CatalogSeedServiceDeps['curatedBaselineRepo'];
  private readonly logger: FastifyBaseLogger;

  constructor(deps: CatalogSeedServiceDeps) {
    this.openai = deps.openai;
    this.kitchenMapService = deps.kitchenMapService;
    this.recipesRepo = deps.recipesRepo;
    this.householdsRepo = deps.householdsRepo;
    this.guardrailRepo = deps.guardrailRepo;
    this.curatedBaselineRepo = deps.curatedBaselineRepo;
    this.logger = deps.logger;
  }

  /**
   * Stage 1 seeding entry point. NEVER throws — catches everything, logs,
   * returns void. The BullMQ worker calls this and trusts that no exception
   * propagates.
   */
  async seedForHousehold(householdId: string, requestId: string): Promise<void> {
    try {
      // ---- Step 1: idempotency ---------------------------------------------
      const existing = await this.householdsRepo.getStage1CompletedAt(householdId);
      if (existing !== null) {
        this.logger.info(
          {
            module: 'catalog',
            action: 'catalog.stage1.skip_idempotent',
            household_id: householdId,
            stage1_completed_at: existing,
            request_id: requestId,
          },
          'stage 1 seeding skipped — household already completed',
        );
        return;
      }

      // ---- Step 2: snapshot + guardrail rules + curated baseline (parallel)
      let rules: AllergyRule[];
      try {
        rules = await this.guardrailRepo.getRulesForHousehold(householdId);
      } catch (err) {
        if (err instanceof AllergyGuardrailDecryptError) {
          // Fail-closed — without readable allergen data we cannot safely
          // surface ANY personalized catalog. stage1_completed_at stays
          // NULL so 2.6-s4 falls through to cold-start.
          this.logger.error(
            {
              module: 'catalog',
              action: 'catalog.stage1.allergen_decrypt_failure',
              household_id: householdId,
              request_id: requestId,
            },
            'stage 1 aborted — allergen data unreadable; stage1_completed_at left NULL',
          );
          return;
        }
        throw err;
      }

      const [snapshot, baselineRows] = await Promise.all([
        this.buildSnapshot(householdId, rules),
        this.curatedBaselineRepo.findAllActive(),
      ]);

      // Curated baseline normalization map — for in-memory dedup.
      const baselineByNormalized = new Map<
        string,
        (typeof baselineRows)[number]
      >();
      for (const row of baselineRows) {
        baselineByNormalized.set(normalizeName(row.canonical_name), row);
      }

      // ---- Step 3: LLM call -----------------------------------------------
      const prompt = buildCatalogSeedPrompt(snapshot);
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), STAGE1_LLM_TIMEOUT_MS);
      let rawContent: string;
      try {
        const completion = await this.openai.chat.completions.create(
          {
            model: STAGE1_LLM_MODEL,
            temperature: STAGE1_LLM_TEMPERATURE,
            max_tokens: STAGE1_LLM_MAX_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
          },
          { signal: controller.signal },
        );
        rawContent = completion.choices[0]?.message?.content ?? '';
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        this.logger.error(
          {
            module: 'catalog',
            action: isAbort ? 'catalog.stage1.llm_timeout' : 'catalog.stage1.failed',
            household_id: householdId,
            request_id: requestId,
            reason: isAbort ? 'llm_timeout' : 'llm_error',
            err,
          },
          'stage 1 LLM call failed — stage1_completed_at left NULL',
        );
        // TODO(2.6-s5): enqueue catalog.recover.stage2 job here on failure
        return;
      } finally {
        clearTimeout(timeoutHandle);
      }

      // ---- Step 4: parse + Zod validate the response ----------------------
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawContent);
      } catch {
        this.logger.error(
          {
            module: 'catalog',
            action: 'catalog.stage1.failed',
            household_id: householdId,
            request_id: requestId,
            reason: 'response_not_json',
          },
          'stage 1 LLM emitted non-JSON output — stage1_completed_at left NULL',
        );
        // TODO(2.6-s5): enqueue catalog.recover.stage2 job here on failure
        return;
      }

      const responseParse = CatalogSeedResponseSchema.safeParse(parsedJson);
      if (!responseParse.success) {
        this.logger.error(
          {
            module: 'catalog',
            action: 'catalog.stage1.response_schema_invalid',
            household_id: householdId,
            request_id: requestId,
            issues: responseParse.error.issues.slice(0, 5).map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
          'stage 1 LLM response failed schema parse — stage1_completed_at left NULL',
        );
        // TODO(2.6-s5): enqueue catalog.recover.stage2 job here on failure
        return;
      }

      const candidateCount = responseParse.data.items.length;

      // ---- Step 5: per-item Zod validate (already done by response parse,
      // but the brief explicitly calls for a guard) + curated dedup ----------
      const allergenExclusionSet = new Set<string>(
        snapshot.allergen_exclusions.map((a) => a.toLowerCase()),
      );

      type Survivor = {
        canonical_name: string;
        allergen_flags: string[];
        dietary_flags: string[];
        cultural_tags: string[];
        cuisine_tags: string[];
        applicable_slots: Array<ValidSlot>;
      };
      const validated: Survivor[] = [];

      for (let i = 0; i < responseParse.data.items.length; i++) {
        const raw = responseParse.data.items[i]!;
        const itemParse = CatalogSeedItemSchema.safeParse(raw);
        if (!itemParse.success) {
          this.logger.warn(
            {
              module: 'catalog',
              action: 'catalog.stage1.item_invalid',
              household_id: householdId,
              request_id: requestId,
              item_index: i,
            },
            'stage 1 item failed per-item schema parse — dropped',
          );
          continue;
        }
        const item = itemParse.data;

        // Narrow applicable_slots to the engine's accepted enum. Drop any
        // unknown slot strings. If nothing survives, default to ['main'].
        const slots = item.applicable_slots.filter((s): s is ValidSlot =>
          VALID_SLOTS.has(s),
        );
        const applicableSlots: Array<ValidSlot> = slots.length > 0 ? slots : ['main'];

        // Belt-and-suspenders: drop items whose canonical_name contains a
        // hard-excluded allergen token. The guardrail does this too, but
        // pre-filtering reduces noise in the guardrail logs.
        const nameLower = item.canonical_name.toLowerCase();
        const containsExcluded = [...allergenExclusionSet].some((tok) =>
          nameLower.includes(tok),
        );
        if (containsExcluded) {
          this.logger.info(
            {
              module: 'catalog',
              action: 'catalog.stage1.allergen_token_filter',
              household_id: householdId,
              request_id: requestId,
              item_index: i,
            },
            'stage 1 item dropped — canonical_name contains a household allergen token',
          );
          continue;
        }

        // Curated baseline dedup / authoritative-tag overwrite.
        const normalized = normalizeName(item.canonical_name);
        const baselineMatch = baselineByNormalized.get(normalized);
        if (baselineMatch !== undefined) {
          // Compare flag arrays as sets; log only when meaningfully different.
          const disagrees =
            !setsEqual(item.allergen_flags, baselineMatch.allergen_flags) ||
            !setsEqual(item.dietary_flags, baselineMatch.dietary_flags) ||
            !setsEqual(item.cultural_tags, baselineMatch.cultural_tags) ||
            !setsEqual(item.cuisine_tags, baselineMatch.cuisine_tags);
          if (disagrees) {
            this.logger.info(
              {
                module: 'catalog',
                action: 'catalog.stage1.flag_disagreement',
                household_id: householdId,
                request_id: requestId,
                item_index: i,
              },
              'stage 1 item matched curated baseline with differing flags — curated wins',
            );
          }
          validated.push({
            // Keep LLM's canonical_name for display.
            canonical_name: item.canonical_name,
            allergen_flags: [...baselineMatch.allergen_flags],
            dietary_flags: [...baselineMatch.dietary_flags],
            cultural_tags: [...baselineMatch.cultural_tags],
            cuisine_tags: [...baselineMatch.cuisine_tags],
            applicable_slots: [...baselineMatch.applicable_slots],
          });
          continue;
        }

        validated.push({
          canonical_name: item.canonical_name,
          allergen_flags: [...item.allergen_flags],
          dietary_flags: [...item.dietary_flags],
          cultural_tags: [...item.cultural_tags],
          cuisine_tags: [...item.cuisine_tags],
          applicable_slots: applicableSlots,
        });
      }

      if (validated.length < STAGE1_FLOOR) {
        this.logger.warn(
          {
            module: 'catalog',
            action: 'catalog.stage1.floor_breach',
            household_id: householdId,
            request_id: requestId,
            validated_count: validated.length,
            floor: STAGE1_FLOOR,
          },
          'stage 1 validated count below floor — proceeding with available items',
        );
      }

      // ---- Step 6: allergy guardrail filter -------------------------------
      let guardrailBlocked = 0;
      const survivors: Survivor[] = [];
      for (let i = 0; i < validated.length; i++) {
        const item = validated[i]!;
        const verdict = evaluateGuardrail(
          [catalogItemToPlanItem(item, householdId)],
          rules,
        );
        if (verdict.verdict === 'cleared') {
          survivors.push(item);
          continue;
        }
        if (verdict.verdict === 'uncertain') {
          this.logger.warn(
            {
              module: 'catalog',
              action: 'catalog.stage1.guardrail_uncertain',
              household_id: householdId,
              request_id: requestId,
              item_index: i,
              reason: verdict.reason,
            },
            'stage 1 item skipped — guardrail uncertain',
          );
          continue;
        }
        // verdict === 'blocked' — expected outcome for items that trip a
        // household-specific allergen rule. Silently skip; counted in metric.
        guardrailBlocked += 1;
      }

      // ---- Step 7: persist survivors --------------------------------------
      const persisted = await this.recipesRepo.seedFromCatalogBaseline(
        householdId,
        survivors,
        (err, itemIndex) => {
          this.logger.error(
            {
              module: 'catalog',
              action: 'catalog.stage1.persist_item_failed',
              household_id: householdId,
              request_id: requestId,
              item_index: itemIndex,
              err,
            },
            'stage 1 item persist failed — continuing with batch',
          );
        },
        STAGE1_CONFIDENCE_SCORE,
      );

      // ---- Step 8: log completion + set timestamp -------------------------
      this.logger.info(
        {
          module: 'catalog',
          action: 'catalog.stage1.completed',
          household_id: householdId,
          request_id: requestId,
          candidate_count: candidateCount,
          validated_count: validated.length,
          guardrail_blocked_count: guardrailBlocked,
          persisted_count: persisted,
        },
        'stage 1 catalog seeding complete',
      );

      if (persisted < STAGE1_FLOOR) {
        this.logger.warn(
          {
            module: 'catalog',
            action: 'catalog.stage1.below_floor',
            household_id: householdId,
            request_id: requestId,
            persisted_count: persisted,
            floor: STAGE1_FLOOR,
          },
          'stage 1 persisted below floor — 2.6-s5 recovery TBD',
        );
        // TODO(2.6-s5): enqueue catalog.recover.stage2 job here on floor breach
      }

      await this.householdsRepo.setStage1CompletedAt(householdId);
    } catch (err) {
      // Catch-all so the BullMQ worker never sees an exception. Treat as a
      // failure path — leave stage1_completed_at NULL.
      this.logger.error(
        {
          module: 'catalog',
          action: 'catalog.stage1.failed',
          household_id: householdId,
          request_id: requestId,
          reason: 'unexpected_error',
          err,
        },
        'stage 1 catalog seeding failed — stage1_completed_at left NULL',
      );
    }
  }

  /**
   * Build the CatalogSeedSnapshot from the household's KitchenMap projection.
   * The KitchenMapService cache means repeated invocations during the same
   * onboarding session are cheap.
   *
   * allergen_exclusions combines FALCPA categories (always) with whatever the
   * household has declared (per-child + household-wide). The LLM is told to
   * OMIT items containing any of these.
   */
  private async buildSnapshot(
    householdId: string,
    rules: AllergyRule[],
  ): Promise<CatalogSeedSnapshot> {
    const map = await this.kitchenMapService.get(householdId);

    const declaredAllergens = new Set<string>(FALCPA_KEYS);
    for (const r of rules) {
      if (typeof r.allergen === 'string' && r.allergen.length > 0) {
        declaredAllergens.add(r.allergen);
      }
    }

    // Distinct cultural / cuisine / dietary tags across household + children.
    const culturalTags = new Set<string>();
    for (const tag of map.household.cultural_identifiers) culturalTags.add(tag);
    for (const c of map.children) {
      for (const tag of c.cultural_identifiers) culturalTags.add(tag);
    }
    for (const p of map.cultural.active) culturalTags.add(p.key);

    const dietaryFlags = new Set<string>();
    for (const tag of map.household.dietary_preferences) dietaryFlags.add(tag);
    for (const d of map.dietary) dietaryFlags.add(d.tag);

    const cuisineTags = new Set<string>();
    // KitchenMap doesn't carry a top-level cuisine_tags array — cuisine
    // emerges from cultural priors. Use cultural keys as the cuisine seed;
    // the LLM treats culturals as broad and cuisines as specific.
    for (const p of map.cultural.active) cuisineTags.add(p.key);

    const foodPreferences: string[] = [];
    for (const fp of map.food_preferences) {
      if (fp.valence === 'loves' || fp.valence === 'likes') {
        foodPreferences.push(fp.item);
      }
    }

    const bagSlots = new Set<string>();
    for (const c of map.children) {
      if (c.bag_composition.main) bagSlots.add('main');
      if (c.bag_composition.snack) bagSlots.add('snack');
      if (c.bag_composition.extra) bagSlots.add('extra');
    }
    if (bagSlots.size === 0) bagSlots.add('main');

    return {
      household_display_name: map.household.display_name,
      children: map.children.map((c) => ({ name: c.name, age_band: c.age_band })),
      allergen_exclusions: [...declaredAllergens],
      cultural_tags: [...culturalTags],
      cuisine_tags: [...cuisineTags],
      dietary_flags: [...dietaryFlags],
      food_preferences: foodPreferences,
      bag_composition_slots: [...bagSlots],
    };
  }
}

// Normalization mirrors recipes_normalized_canonical_name() in SQL:
//   trim → NFC → strip [\s\-']+ → lowercase
function normalizeName(name: string): string {
  return name
    .trim()
    .normalize('NFC')
    .replace(/[\s\-']+/g, '')
    .toLowerCase();
}

function setsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const v of b) {
    if (!setA.has(v)) return false;
  }
  return true;
}
