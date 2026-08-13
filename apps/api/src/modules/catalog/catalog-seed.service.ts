import type { FastifyBaseLogger } from 'fastify';
import type { Queue } from 'bullmq';
import type OpenAI from 'openai';
import { z } from 'zod';
import {
  AllergyGuardrailDecryptError,
  type AllergyGuardrailRepository,
} from '../allergy-guardrail/allergy-guardrail.repository.js';
import {
  evaluate as evaluateGuardrail,
  isHardRule,
  type AllergyRule,
} from '../allergy-guardrail/allergy-rules.engine.js';
import type { HouseholdsRepository } from '../households/households.repository.js';
import type { KitchenMapService } from '../kitchen-map/kitchen-map.service.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import type { OnboardingChipSuggestionRepository } from './onboarding-chip-suggestion.repository.js';
import { catalogItemToPlanItem } from './catalog-guardrail-helper.js';
import {
  buildCatalogSeedPrompt,
  type CatalogSeedSnapshot,
} from '../../agents/prompts/catalog-seed.prompt.js';
import {
  CATALOG_RECOVERY_QUEUE,
  CATALOG_RECOVERY_JOB_OPTS,
  type CatalogRecoveryJobData,
} from '../../jobs/catalog-recovery.job.js';
import type { Stage2Trigger } from './catalog-recovery.service.js';

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
// THROWS on retryable failure. It used to swallow everything, which meant the
// worker's `attempts: 2` retry config never fired — the job always resolved
// "successfully" and a single LLM timeout stranded the household on the Stage 0
// baseline permanently. Terminal failures (unreadable allergen data) still
// return quietly: retrying a deterministic failure only burns the queue.
// stage1_completed_at stays NULL on every failure path, so the M5 surface's
// poll + cold-start fallback behave exactly as before.

// Confidence for Stage 1 LLM-seeded rows — slightly less trusted than the
// hand-curated baseline's 60.
const STAGE1_CONFIDENCE_SCORE = 50;
// LLM call hard timeout. This was 5s, borrowed from the M5 chip poll's 5s
// window — but those are unrelated budgets. Nothing blocks on this call: it is
// a background BullMQ job, and the M5 surface polls `stage1_completed_at`
// independently and falls back on its own schedule. Asking gpt-4o for up to
// 4,000 tokens of JSON inside 5s routinely aborted, which is the single most
// likely reason a household ends up stranded on the Stage 0 baseline.
const STAGE1_LLM_TIMEOUT_MS = 30_000;
const STAGE1_LLM_MODEL = 'gpt-4o';
const STAGE1_LLM_TEMPERATURE = 0.7;
const STAGE1_LLM_MAX_TOKENS = 4_000;
// Below this many validated items, log floor_breach. Stage 1 still persists
// whatever survived. This local floor is distinct from the Stage 2 trigger
// floor below — STAGE1_FLOOR governs only the warning emitted by Stage 1.
const STAGE1_FLOOR = 10;
// Slice 2.6-s5 — household-wide post-Stage-1 catalog count below this floor
// triggers a Stage 2 recovery job. Includes both Stage 0 and Stage 1
// catalog_seeded rows; queried via RecipesRepository.countCatalogSeededForHousehold.
const STAGE2_FLOOR = 35;
// Slice 2.6-s5 — guardrail-block ratio threshold for the mass-block trigger.
// Denominator = LLM emission count (candidateCount); a ratio above this
// threshold enqueues a Stage 2 recovery job after the persist step.
const STAGE2_MASS_BLOCK_RATIO = 0.5;
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
const CatalogSeedItemSchema = z.object({
  canonical_name: z.string().min(1).max(200),
  allergen_flags: z.array(z.string()),
  dietary_flags: z.array(z.string()),
  cultural_tags: z.array(z.string()),
  cuisine_tags: z.array(z.string()),
  applicable_slots: z.array(z.string()).min(1),
  // Slice 16-s1 (AC 12) — the deterministic diversity backstop needs a real
  // structured field to bucket on; cuisine_tags alone let three chicken-rice
  // dishes across three cuisines all pass. "none" (not empty string) is the
  // LLM's explicit way to say a dish has no dominant starch/protein.
  primary_starch: z.string().max(64),
  primary_protein: z.string().max(64),
});

const CatalogSeedResponseSchema = z.object({
  items: z.array(CatalogSeedItemSchema),
});

const VALID_SLOTS = new Set(['main', 'snack', 'extra']);
type ValidSlot = 'main' | 'snack' | 'extra';

/**
 * A Stage 1 failure worth retrying — an LLM timeout, a transport error, or a
 * malformed response. Already logged at its call site; the top-level handler
 * rethrows it so BullMQ retries rather than marking the job done.
 *
 * Deliberately NOT used for terminal failures like unreadable allergen data:
 * those are deterministic, and retrying them just burns queue capacity.
 */
class Stage1RetryableError extends Error {
  constructor(readonly reason: string) {
    super(`stage 1 seeding failed: ${reason}`);
    this.name = 'Stage1RetryableError';
  }
}

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
  // Slice 2.6-s5 — Stage 2 recovery queue. Optional so legacy tests that don't
  // wire it continue to compile; absence is logged as a warn at trigger time.
  recoveryQueue?: Queue<CatalogRecoveryJobData>;
  // Slice 16-s1 (AC 6) — the SAME filtered survivors that seed `recipes` also
  // persist here, from the same array, no forked filter.
  onboardingChipSuggestionRepo: OnboardingChipSuggestionRepository;
  logger: FastifyBaseLogger;
}

export class CatalogSeedService {
  private readonly openai: OpenAI;
  private readonly kitchenMapService: KitchenMapService;
  private readonly recipesRepo: RecipesRepository;
  private readonly householdsRepo: HouseholdsRepository;
  private readonly guardrailRepo: AllergyGuardrailRepository;
  private readonly curatedBaselineRepo: CatalogSeedServiceDeps['curatedBaselineRepo'];
  private readonly recoveryQueue: Queue<CatalogRecoveryJobData> | undefined;
  private readonly onboardingChipSuggestionRepo: OnboardingChipSuggestionRepository;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: CatalogSeedServiceDeps) {
    this.openai = deps.openai;
    this.kitchenMapService = deps.kitchenMapService;
    this.recipesRepo = deps.recipesRepo;
    this.householdsRepo = deps.householdsRepo;
    this.guardrailRepo = deps.guardrailRepo;
    this.curatedBaselineRepo = deps.curatedBaselineRepo;
    this.recoveryQueue = deps.recoveryQueue;
    this.onboardingChipSuggestionRepo = deps.onboardingChipSuggestionRepo;
    this.logger = deps.logger;
  }

  /**
   * Slice 2.6-s5 — fire-and-forget Stage 2 recovery enqueue. NEVER awaited
   * by callers; queue.add rejections are caught + logged so Stage 1's hot
   * path is never blocked. BullMQ jobId dedup ensures only one Stage 2 job
   * runs per household even if both mass-block and floor-breach trigger.
   */
  private enqueueRecovery(
    householdId: string,
    requestId: string,
    triggeredBy: Stage2Trigger,
    opts?: { emitted_count?: number; blocked_count?: number },
  ): void {
    if (this.recoveryQueue === undefined) {
      this.logger.warn(
        {
          module: 'catalog',
          action: 'catalog.stage2.recovery_skipped_no_queue',
          household_id: householdId,
          request_id: requestId,
          triggered_by: triggeredBy,
        },
        'stage 2 recovery skipped — recoveryQueue not wired',
      );
      return;
    }
    const jobData: CatalogRecoveryJobData = {
      household_id: householdId,
      request_id: requestId,
      triggered_by: triggeredBy,
      ...(opts?.emitted_count !== undefined
        ? { emitted_count: opts.emitted_count }
        : {}),
      ...(opts?.blocked_count !== undefined
        ? { blocked_count: opts.blocked_count }
        : {}),
    };
    void this.recoveryQueue
      .add(CATALOG_RECOVERY_QUEUE, jobData, {
        ...CATALOG_RECOVERY_JOB_OPTS,
        // BullMQ dedup: at most one Stage 2 job per household at a time.
        // If a job with the same id is already queued, the add is a no-op.
        jobId: `${CATALOG_RECOVERY_QUEUE}:${householdId}`,
      })
      .catch((err: unknown) => {
        this.logger.error(
          {
            module: 'catalog',
            action: 'catalog.stage2.enqueue_failed',
            household_id: householdId,
            request_id: requestId,
            triggered_by: triggeredBy,
            err,
          },
          'stage 2 recovery enqueue failed',
        );
      });
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
        this.enqueueRecovery(householdId, requestId, 'stage1_failure');
        throw new Stage1RetryableError(isAbort ? 'llm_timeout' : 'llm_error');
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
        this.enqueueRecovery(householdId, requestId, 'stage1_failure');
        throw new Stage1RetryableError('response_not_json');
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
        this.enqueueRecovery(householdId, requestId, 'stage1_failure');
        throw new Stage1RetryableError('response_schema_invalid');
      }

      const candidateCount = responseParse.data.items.length;

      // ---- Step 5: per-item Zod validate (already done by response parse,
      // but the brief explicitly calls for a guard) + curated dedup ----------
      const allergenExclusionSet = new Set<string>(
        snapshot.allergen_exclusions.map((a) => a.toLowerCase()),
      );
      // Slice 16-s1 (AC 7) — distinguishes a block's SOURCE for the chip
      // block log. allergenExclusionSet merges FALCPA_KEYS with declared
      // allergens (buildSnapshot); this narrower set is declared-only, so a
      // matched token found here is 'declared', otherwise it's 'falcpa'.
      const declaredOnlyTokens = new Set<string>(
        rules.filter(isHardRule).map((r) => r.allergen.toLowerCase()),
      );

      type Survivor = {
        canonical_name: string;
        allergen_flags: string[];
        dietary_flags: string[];
        cultural_tags: string[];
        cuisine_tags: string[];
        applicable_slots: Array<ValidSlot>;
        primary_starch: string;
        primary_protein: string;
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
        const matchedToken = [...allergenExclusionSet].find((tok) =>
          nameLower.includes(tok),
        );
        if (matchedToken !== undefined) {
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
          // Slice 16-s1 (AC 7) — evidence base for revisiting decision 1: the
          // label IS the payload here (the suggestion was never shown to a
          // parent, unlike a recipe row).
          this.logger.info(
            {
              module: 'catalog',
              action: 'catalog.chips.blocked',
              household_id: householdId,
              request_id: requestId,
              label: item.canonical_name,
              allergen: matchedToken,
              source: declaredOnlyTokens.has(matchedToken) ? 'declared' : 'falcpa',
            },
            'chip suggestion blocked — canonical_name contains a household allergen token',
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
            // curated_baseline_items carries no starch/protein columns — keep
            // the LLM's own classification, same as canonical_name above.
            primary_starch: item.primary_starch,
            primary_protein: item.primary_protein,
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
          primary_starch: item.primary_starch,
          primary_protein: item.primary_protein,
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
        // household-specific allergen rule. Counted in metric AND logged for
        // chips (AC 7) — conflicts is non-empty by schema (min(1)).
        guardrailBlocked += 1;
        const matchedAllergen = verdict.conflicts[0]!.allergen.toLowerCase();
        this.logger.info(
          {
            module: 'catalog',
            action: 'catalog.chips.blocked',
            household_id: householdId,
            request_id: requestId,
            label: item.canonical_name,
            allergen: matchedAllergen,
            // Guardrail 1.4.0+ only ever blocks on a parent_declared/
            // household_rule_hard rule (FALCPA is vocabulary + baseline-
            // presence only, not a blocking mechanism here) — but compute
            // from declaredOnlyTokens rather than hardcode 'declared', so
            // this stays correct if that invariant ever changes.
            source: declaredOnlyTokens.has(matchedAllergen) ? 'declared' : 'falcpa',
          },
          'chip suggestion blocked — allergy guardrail',
        );
      }

      // Slice 2.6-s5 — mass-block detection. Fires BEFORE persist so Stage 2
      // is queued even if persist later fails. Denominator = LLM emission
      // count (candidateCount); brief rev 3 locks this denominator.
      const massBlockRatio =
        candidateCount > 0 ? guardrailBlocked / candidateCount : 0;
      if (massBlockRatio > STAGE2_MASS_BLOCK_RATIO) {
        this.logger.warn(
          {
            module: 'catalog',
            action: 'catalog.stage1.mass_block_detected',
            household_id: householdId,
            request_id: requestId,
            emitted_count: candidateCount,
            blocked_count: guardrailBlocked,
            ratio: massBlockRatio,
          },
          'stage 1 mass-block detected — Stage 2 recovery enqueued',
        );
        this.enqueueRecovery(householdId, requestId, 'mass_block', {
          emitted_count: candidateCount,
          blocked_count: guardrailBlocked,
        });
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

      // Slice 16-s1 (AC 4, 6) — the SAME survivors also become the M5 chip
      // source. Failure here must not undo the recipes persist that just
      // succeeded — recipe seeding is the pre-existing, load-bearing
      // guarantee until 16-s3 retires it; the chip suggestion store is new
      // and additive. Caught and logged, not rethrown.
      try {
        await this.onboardingChipSuggestionRepo.insertMany(
          householdId,
          survivors.map((s) => ({
            label: s.canonical_name,
            cuisine_tags: s.cuisine_tags,
            dietary_flags: s.dietary_flags,
            allergen_flags: s.allergen_flags,
            // Slice 16-s1 (AC 12) — normalize the LLM's explicit "none" (and
            // an empty string, belt-and-suspenders) to a real null, so the
            // diversity bucketing downstream only ever has to check for
            // null/empty, not match a literal string.
            primary_starch: normalizeStarchProtein(s.primary_starch),
            primary_protein: normalizeStarchProtein(s.primary_protein),
          })),
        );
      } catch (err) {
        this.logger.error(
          {
            err,
            module: 'catalog',
            action: 'catalog.chips.persist_failed',
            household_id: householdId,
            request_id: requestId,
          },
          'chip suggestion persist failed — recipes catalog seeding still succeeded',
        );
      }

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
        // Diagnostic warning — Stage 1's own batch fell below STAGE1_FLOOR.
        // Distinct from the Stage 2 trigger below which evaluates total
        // household catalog count (Stage 0 + Stage 1 combined) against
        // STAGE2_FLOOR.
        this.logger.warn(
          {
            module: 'catalog',
            action: 'catalog.stage1.below_floor',
            household_id: householdId,
            request_id: requestId,
            persisted_count: persisted,
            floor: STAGE1_FLOOR,
          },
          'stage 1 persisted below local floor — see stage2.floor_breach for trigger evaluation',
        );
      }

      await this.householdsRepo.setStage1CompletedAt(householdId);

      // Slice 2.6-s5 — floor-breach detection. Runs AFTER stage1_completed_at
      // is set so the Stage 2 worker's stage1-in-flight guard sees a real
      // completion timestamp. Total count includes Stage 0 + Stage 1 rows.
      try {
        const totalSeeded = await this.recipesRepo.countCatalogSeededForHousehold(
          householdId,
        );
        if (totalSeeded < STAGE2_FLOOR) {
          this.logger.warn(
            {
              module: 'catalog',
              action: 'catalog.stage2.floor_breach_detected',
              household_id: householdId,
              request_id: requestId,
              total_seeded: totalSeeded,
              floor: STAGE2_FLOOR,
            },
            'stage 2 floor breach detected — recovery enqueued',
          );
          this.enqueueRecovery(householdId, requestId, 'floor_breach');
        }
      } catch (err) {
        // Count query failure is non-fatal — log and continue. Stage 1's
        // happy path already succeeded; the next M5 entry will route through
        // whatever catalog exists.
        this.logger.error(
          {
            module: 'catalog',
            action: 'catalog.stage2.floor_breach_check_failed',
            household_id: householdId,
            request_id: requestId,
            err,
          },
          'stage 2 floor-breach check failed — Stage 1 succeeded; no recovery enqueued',
        );
      }
    } catch (err) {
      // Retryable failures were already logged at their own call site with a
      // precise action string; rethrow so the worker's `attempts: 2` engages.
      // Before this, the service swallowed everything, the job always resolved
      // "successfully", and the retry config was decorative.
      const reason =
        err instanceof Stage1RetryableError ? err.reason : 'unexpected_error';
      if (!(err instanceof Stage1RetryableError)) {
        this.logger.error(
          {
            module: 'catalog',
            action: 'catalog.stage1.failed',
            household_id: householdId,
            request_id: requestId,
            reason,
            err,
          },
          'stage 1 catalog seeding failed — stage1_completed_at left NULL',
        );
      }
      // Best-effort breadcrumb so stuck households are queryable:
      //   SELECT id, stage1_attempts, stage1_last_error
      //   FROM households WHERE stage1_completed_at IS NULL;
      try {
        await this.householdsRepo.setStage1LastError(householdId, reason);
      } catch {
        // Never let the breadcrumb write mask the original failure.
      }
      throw err instanceof Error ? err : new Error(String(err));
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

    // Slice 16-s1 — split on enforcement instead of flattening to bare tags.
    // The M5 projection filter drops items violating a non_negotiable dietary
    // tag, so folding those in with soft leanings meant the prompt could be
    // asked for dishes that were then silently discarded downstream.
    const dietaryNonNegotiable = new Set<string>();
    for (const d of map.dietary) {
      if (d.enforcement === 'non_negotiable') dietaryNonNegotiable.add(d.tag);
    }

    const dietaryFlags = new Set<string>();
    // The legacy household column carries no enforcement, so it defaults to
    // soft — UNLESS the same tag is also declared non_negotiable via the
    // structured table, in which case the hard exclusion wins. Review
    // follow-up (16-s1): this loop used to skip the dietaryNonNegotiable
    // check, so an overlapping tag rendered as both a hard exclusion and a
    // soft leaning in the same prompt.
    for (const tag of map.household.dietary_preferences) {
      if (!dietaryNonNegotiable.has(tag)) dietaryFlags.add(tag);
    }
    for (const d of map.dietary) {
      if (!dietaryNonNegotiable.has(d.tag)) dietaryFlags.add(d.tag);
    }

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
      dietary_non_negotiable: [...dietaryNonNegotiable],
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

// Slice 16-s1 (AC 12) — the LLM's explicit "no dominant starch/protein"
// signal ("none") and an empty string both mean the same thing: no value.
function normalizeStarchProtein(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 || trimmed === 'none' ? null : value.trim();
}
