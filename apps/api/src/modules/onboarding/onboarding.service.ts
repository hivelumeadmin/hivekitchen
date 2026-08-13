import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Queue } from 'bullmq';
import { OPENING_GREETING, M1_HINT_CHIPS, BagCompositionPatternSchema, type ChipConfig, type ChipOption } from '@hivekitchen/contracts';
import type { VocabularySnapshot } from '@hivekitchen/types';
import {
  buildM2AllergenChips,
  buildM2AttributionChips,
  buildM3TasteChips,
  buildM4BagChips,
  RATIFICATION_CHIPS,
  M3_DIETARY_CHIP_KEYS,
  M3_CUISINE_CHIP_KEYS,
} from './onboarding-chips.js';
import {
  CATALOG_SEED_JOB_OPTS,
  CATALOG_SEED_QUEUE,
  type CatalogSeedJobData,
} from '../../jobs/catalog-seed.job.js';
import { ConflictError, UpstreamError } from '../../common/errors.js';
import { stripExpressionTags } from '../../common/strip-expression-tags.js';
import type {
  OnboardingAgent,
  LlmMessage,
} from '../../agents/onboarding.agent.js';
import { createOnboardingTracer } from '../../agents/onboarding-tracer.js';
import type { ChildAllergensRepository } from '../children/child-allergens.repository.js';
import type { ChildrenService } from '../children/children.service.js';
import type { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import type { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';
import type { DietaryPreferencesRepository } from '../dietary-preferences/dietary-preferences.repository.js';
import type { FoodPreferencesRepository } from '../food-preferences/food-preferences.repository.js';
import type { SignalsService } from '../signals/signals.service.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import type { OnboardingChipSuggestionRepository } from '../catalog/onboarding-chip-suggestion.repository.js';
import type { HouseholdRulesRepository } from '../household-rules/household-rules.repository.js';
import type { HouseholdsRepository } from '../households/households.repository.js';
import type { HouseholdsService } from '../households/households.service.js';
import type { CuratedBaselineMaterializationService } from '../catalog/curated-baseline.service.js';
import type { CatalogProjectionService } from '../catalog/catalog-projection.service.js';
import type { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';
import type { KitchenMapService } from '../kitchen-map/kitchen-map.service.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { VocabularyService } from '../vocabulary/vocabulary.service.js';
import {
  isUniqueViolation,
  type ThreadRepository,
  type ThreadRow,
  type TurnRow,
} from '../threads/thread.repository.js';
import type {
  CurrentMoment,
  MomentState,
  OnboardingMomentRepository,
  RequiredSetStatus,
} from './onboarding-moment.repository.js';
import { OnboardingController, type OnboardingSlots } from './onboarding.controller.js';
import { OnboardingTurnRunner } from './onboarding-turn-runner.js';

export interface OnboardingServiceDeps {
  threads: ThreadRepository;
  agent: OnboardingAgent;
  culturalPriorService: CulturalPriorService;
  logger: FastifyBaseLogger;
  memoryService?: MemoryService;
  // Slice C — optional tool-loop deps. When all four are provided AND the
  // feature flag is true, submitTextTurn drives the agent's tool-call loop
  // to populate the kitchen map progressively. When any is missing or the
  // flag is false, the service falls back to the legacy single-shot path.
  childrenService?: ChildrenService;
  culturalPriorRepository?: CulturalPriorRepository;
  householdsService?: HouseholdsService;
  kitchenMapService?: KitchenMapService;
  vocabularyService?: VocabularyService;
  agentToolsEnabled?: boolean;
  // Slice 2.5-s4 — chaptered-conversation moment tracker. Optional for
  // backward compatibility with existing unit-test deps; when absent the
  // service falls back to a null moment state (agent treats as pre_start)
  // and skips the post-turn upsert. When present, drives the moment-advance
  // protocol and chip_config emission.
  momentRepository?: OnboardingMomentRepository;
  // Slice 2.5-s6 — structured per-child allergen + (household-or-child)
  // dietary writers. Required when the tool loop runs; the wired tool specs
  // throw at call time if absent. Optional on the type so legacy unit-test
  // deps that don't construct the tool loop still compile.
  childAllergensRepository?: ChildAllergensRepository;
  dietaryPreferencesRepository?: DietaryPreferencesRepository;
  // Slice 2.5-s7 — structured food-preference + household-rule writers for
  // food_preference.declare / rule.set. Same optionality + run-time guarding
  // pattern as the 2.5-s6 deps above.
  foodPreferencesRepository?: FoodPreferencesRepository;
  // Story 15-s2 — signals-log dual-write for food_preference.declare.
  signalsService?: SignalsService;
  householdRulesRepository?: HouseholdRulesRepository;
  // Slice 2.6-s1 — replaces favoriteLunchesRepository (2.5-s9). The M5 hot
  // path now writes to the canonical recipes catalog via RecipesRepository
  // .declareForHousehold(); the standalone favorite_lunches table is dropped
  // by migration 20260908000200.
  recipesRepository?: RecipesRepository;
  // Slice 16-s1 (AC 5) — M5 chip-key resolution checks this FIRST, before the
  // recipesRepository fallback above. Generated-suggestion chips have no
  // recipes row; declared-favourite chips still resolve via recipes.id.
  onboardingChipSuggestionRepository?: OnboardingChipSuggestionRepository;
  // Slice 2.6-s2 — Stage 0 catalog re-materialization fires fire-and-forget
  // when the parent advances out of m3_taste. Optional so legacy tests that
  // don't wire the catalog still pass; production composition provides it.
  curatedBaseline?: CuratedBaselineMaterializationService;
  // Slice 2.6-s3 — BullMQ queue handle for the Stage 1 catalog-seed job.
  // Fire-and-forget enqueue at m2_safe exit. Optional so legacy tests that
  // don't wire the queue still compile.
  catalogSeedQueue?: Queue<CatalogSeedJobData>;
  // Slice 2.6-s4 — per-household M5 chip projection. Reads the catalog
  // (recipes + household_recipe_usage) at turn-time and returns ChipOption[]
  // with provenance. Optional: legacy tests that don't wire the catalog still
  // pass; when absent, M5 chip_config falls back to null (deleted static set).
  catalogProjection?: CatalogProjectionService;
  // M5 personalization — reads declared allergens so allergen-conflicting
  // recipes are excluded from the chip set before it is shown to the parent.
  householdAllergensRepository?: HouseholdAllergensRepository;
  // Stage 1 retry accounting for the idempotent ensure (stage1_completed_at /
  // stage1_attempts). Optional: without it the ensure degrades to the old
  // fire-once behaviour rather than failing the turn.
  householdsRepository?: HouseholdsRepository;
}

export interface SubmitTextTurnInput {
  userId: string;
  householdId: string;
  message: string;
}

export interface SubmitTextTurnResult {
  thread_id: string;
  turn_id: string;
  lumi_turn_id: string;
  lumi_response: string;
  is_complete: boolean;
  // Slice 2.5-s4 — chip-config the client should render alongside Lumi's
  // next question. Derived from the moment the agent transitioned INTO this
  // turn (i.e. the moment the parent's NEXT turn will operate within).
  chip_config: ChipConfig | null;
  // Slice 2.5-s5 — current moment after this turn. Client renders the
  // "Moment X of 5 · <name>" header from this. Defaults to 'm1_table' on
  // the first turn when the agent emits no [NEXT_MOMENT:] directive.
  moment_key: string | null;
  // Slice 2.5-s10 — required-set completion derived from the post-turn
  // moment state. null when momentRepository is absent (legacy/test path).
  // The client uses this to enable/disable the summary finalize gate.
  required_set_complete: boolean | null;
  // Slice 2.5-s10 — moment keys whose required answers are still missing.
  // Valid values: 'm1_table' | 'm2_safe' | 'm5_starting_line'. Empty array
  // when all required moments are complete OR momentRepository is absent.
  missing_required_set: string[];
  // Household display_name from the kitchen map at the time of the turn.
  // null on the M1 turn where household.set_name just fired (map is read
  // before tool calls); real value from M2 onward.
  household_display_name: string | null;
  // Slice 2-S26 — internal signal for the route handler's audit emission.
  // Stripped by the response Zod schema before serialization (the wire shape
  // is TextOnboardingTurnResponseSchema, which excludes this field).
  // True when the household already had ≥1 message turn on this thread
  // before this call ran — i.e., the user is mid-conversation, not on turn 1.
  _was_resumed: boolean;
  // Slice 2.6-s6 — cold-start fallback mode for M5. When true, the client
  // renders the conversational tail (no chip card, 3-dish gate) instead
  // of the chip catalog. Sticky: once true for a household, stays true on
  // every subsequent turn this session.
  cold_start_mode: boolean;
}

export interface FinalizeTextOnboardingResult {
  thread_id: string;
  summary: {
    cultural_templates: string[];
    palate_notes: string[];
    allergens_mentioned: string[];
    family_rhythms: string[];
  };
}

// Slice 2-S26 — resume-mid-flow state shape returned from getState().
// Mirrors the contract in @hivekitchen/contracts (OnboardingStateResponseSchema).
// Kept as a service-layer interface to avoid the route directly importing
// the contract type and re-shaping in two places.
export interface OnboardingStateResult {
  status: 'not_started' | 'in_progress' | 'completed';
  thread_id?: string;
  modality?: 'text' | 'voice';
  started_at?: string;
  last_activity_at?: string;
  turns?: Array<{
    id: string;
    role: 'user' | 'lumi';
    content: string;
    created_at: string;
  }>;
  household_display_name?: string | null;
  current_moment?: string | null;
  chip_config?: ChipConfig | null;
}

export interface OnboardingResetResult {
  // The closed thread's id, if one was actually closed (vs. idempotent no-op).
  // Caller uses this for the audit metadata so the prior thread is discoverable.
  closed_thread_id: string | null;
}

const ONBOARDING_THREAD_TYPE = 'onboarding';
const SUMMARY_EVENT = 'onboarding.summary';
const TEXT_MODALITY = 'text' as const;

// Slice 2.5-s4 — strips ALL [NEXT_MOMENT:<key>] occurrences from agent text.
// Using a global regex handles both mid-prose directives (epilogue prose after
// the directive) and duplicate directives in one pass. The captured group from
// the last occurrence becomes the next current_moment value.
const NEXT_MOMENT_STRIP_RE = /\[NEXT_MOMENT:[a-z0-9_]+\]/g;

// M3 chip keys — derived from the canonical source in onboarding-chips.ts so
// the safety net and the chip builder stay in sync automatically (P2, 2.7-s5 CR).
const M3_CHIP_KEYS = new Set([...M3_DIETARY_CHIP_KEYS, ...M3_CUISINE_CHIP_KEYS]);

// M4 bag chip keys — derived from BagCompositionPatternSchema so any new enum
// value lights up the safety net without a second hand-edit (P2, 2.7-s5 CR).
const M4_BAG_CHIP_KEYS: Set<string> = new Set(BagCompositionPatternSchema.options);

// Bounds the idempotent Stage 1 ensure. Two checkpoints per interview (M2 exit,
// M5 entry) means a healthy household enqueues once and the second checkpoint
// no-ops; this cap only bites when seeding keeps failing.
const STAGE1_MAX_ATTEMPTS = 3;

// Slice 2.7-s7 — the M3 enforcement-ratification chip keys, derived from the
// RATIFICATION_CHIPS source. Tapping one of these is the parent's M3 answer
// (it re-declares the tag with the chosen enforcement), so it advances M3.
const RATIFICATION_KEYS: Set<string> = new Set(
  (RATIFICATION_CHIPS.options ?? []).map((o) => o.key),
);

// Parse the `[Chips selected: key1, key2]` prefix from a user message string.
// Returns an empty array when no chip prefix is present.
function parseChipKeys(message: string): string[] {
  const match = /\[Chips selected:\s*([^\]]+)\]/.exec(message);
  if (match === null) return [];
  return match[1]!.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
}

// M5 chip keys are recipe UUIDs (8-4-4-4-12). All other moment chip keys
// are short human-readable slugs (e.g. 'peanut', 'south_indian'). Used to
// detect M5 chip turns without needing the moment state at message-parse time.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Slice 2.7-s5 — the [CHIP_PROMPT:elevation:<tag_key>:<tag_label>] prose
// sentinel (2.5-s7) is gone. M3 enforcement ratification now rides the
// structured `request_ratification` field on dietary.declare / cuisine.declare;
// the ratification chip is rendered from the tool RESULT (see submitTextTurn),
// so it can never half-leak into the visible message. Any stray legacy sentinel
// in agent output is stripped defensively below as belt-and-braces.
const ELEVATION_SENTINEL_STRIP_RE = /\[CHIP_PROMPT:elevation:[a-z0-9_]+:[^\]]+\]/g;

const VALID_MOMENT_KEYS: ReadonlySet<CurrentMoment> = new Set<CurrentMoment>([
  'pre_start',
  'm1_table',
  'm2_safe',
  'm3_taste',
  'm4_bag',
  'm5_starting_line',
  'summary',
  'finalized',
]);

// Forward-only transition enforcement: the agent may only advance to a moment
// that is equal to or later in the sequence. Backward directives (e.g.
// [NEXT_MOMENT:pre_start] mid-interview) are silently rejected — current_moment
// is preserved and the agent re-reads the same moment on the next turn.
const MOMENT_ORDER: Readonly<Record<CurrentMoment, number>> = {
  pre_start: 0,
  m1_table: 1,
  m2_safe: 2,
  m3_taste: 3,
  m4_bag: 4,
  m5_starting_line: 5,
  summary: 6,
  finalized: 7,
};

function parseMomentKey(value: string | null, fromMoment?: CurrentMoment): CurrentMoment | null {
  if (value === null) return null;
  if (!(VALID_MOMENT_KEYS as ReadonlySet<string>).has(value)) return null;
  const candidate = value as CurrentMoment;
  // pre_start is an internal bootstrap state — not a valid agent-emittable
  // directive. Accepting it would bypass the pre_start → m1_table promotion
  // and anchor the conversation permanently at pre_start.
  if (candidate === 'pre_start') return null;
  if (fromMoment !== undefined && MOMENT_ORDER[candidate] < MOMENT_ORDER[fromMoment]) {
    return null; // reject backward transition
  }
  return candidate;
}

// Slice 2.7-s5 — chip_config per current_moment. The hand-copied literal
// option lists (three silent drift points) are replaced by generators in
// onboarding-chips.ts whose KEY SETS derive from their source of truth:
//   M2 → FALCPA subset of the allergen vocabulary (needs the snapshot),
//   M3 → curated dietary/cuisine subset (drift-tested against the vocabulary),
//   M4 → BagCompositionPatternSchema (the contract enum).
// `vocab` is the VocabularyService snapshot; when absent (legacy non-tool path,
// or the eval vocab fake's empty snapshot) M2 falls back to the canonical
// FALCPA-9 set so behaviour is unchanged.
export function momentToChipConfig(
  moment: CurrentMoment,
  vocab?: VocabularySnapshot,
): ChipConfig | null {
  switch (moment) {
    case 'm1_table':
      return M1_HINT_CHIPS;
    case 'm2_safe':
      // M2 is the safety wall: multi-select FALCPA allergen chips with an
      // exclusive "No known allergens" option. The client enforces 'none'
      // mutual exclusion (AC6). NO skip_label — M2 is REQUIRED.
      return buildM2AllergenChips(vocab);
    case 'm3_taste':
      // M3 — dietary + cuisine choice chips (optional; first-class skip).
      return buildM3TasteChips();
    case 'm4_bag':
      // M4 — single-select bag-composition action chips (required, no skip).
      return buildM4BagChips();
    case 'm5_starting_line':
      // Slice 2.6-s4 — the static 18-chip catalog was deleted. M5 chips are
      // now injected dynamically in submitTextTurn from CatalogProjectionService
      // (per-household catalog read at turn-time). Returning null here keeps
      // the moment-to-config mapping honest: it has no static answer for M5.
      return null;
    case 'pre_start':
    case 'summary':
    case 'finalized':
    default:
      return null;
  }
}

const onlyStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export class OnboardingService {
  private readonly threads: ThreadRepository;
  private readonly agent: OnboardingAgent;
  private readonly culturalPriorService: CulturalPriorService;
  private readonly logger: FastifyBaseLogger;
  private readonly memoryService?: MemoryService;
  // Slice C optional deps
  private readonly childrenService?: ChildrenService;
  private readonly culturalPriorRepository?: CulturalPriorRepository;
  private readonly householdsService?: HouseholdsService;
  private readonly kitchenMapService?: KitchenMapService;
  private readonly vocabularyService?: VocabularyService;
  private readonly agentToolsEnabled: boolean;
  private readonly momentRepository?: OnboardingMomentRepository;
  // Slice 2.5-s6
  private readonly childAllergensRepository?: ChildAllergensRepository;
  private readonly dietaryPreferencesRepository?: DietaryPreferencesRepository;
  // Slice 2.5-s7
  private readonly foodPreferencesRepository?: FoodPreferencesRepository;
  private readonly signalsService?: SignalsService;
  private readonly householdRulesRepository?: HouseholdRulesRepository;
  // Slice 2.6-s1 (replaces 2.5-s9 favoriteLunchesRepository)
  private readonly recipesRepository?: RecipesRepository;
  // Slice 16-s1 (AC 5) — checked before recipesRepository for chip-key resolution
  private readonly onboardingChipSuggestionRepository?: OnboardingChipSuggestionRepository;
  // Slice 2.6-s2 — Stage 0 catalog re-seed at M3 exit
  private readonly curatedBaseline?: CuratedBaselineMaterializationService;
  // Slice 2.6-s3 — Stage 1 catalog seed fire-and-forget queue at M2 exit
  private readonly catalogSeedQueue?: Queue<CatalogSeedJobData>;
  // Slice 2.6-s4 — M5 personalized chip projection
  private readonly catalogProjection?: CatalogProjectionService;
  // M5 personalization — allergen filter
  private readonly householdAllergensRepository?: HouseholdAllergensRepository;
  // Stage 1 retry accounting for the idempotent ensure
  private readonly householdsRepository?: HouseholdsRepository;
  // Slice 2.7-s6 — deterministic FSM. Pure, stateless; safe to share one
  // instance across all turns. Runs in shadow (transition comparison + log)
  // and owns the AC3 slot-derived household-name chip swap.
  private readonly controller = new OnboardingController();
  // Slice 2.7-s7 — the stateless turn function (assemble → call provider →
  // execute tools). Pure of FSM concerns (those live in the controller above).
  private readonly turnRunner: OnboardingTurnRunner;

  constructor(deps: OnboardingServiceDeps) {
    this.threads = deps.threads;
    this.agent = deps.agent;
    this.culturalPriorService = deps.culturalPriorService;
    this.logger = deps.logger;
    this.memoryService = deps.memoryService;
    this.childrenService = deps.childrenService;
    this.culturalPriorRepository = deps.culturalPriorRepository;
    this.householdsService = deps.householdsService;
    this.kitchenMapService = deps.kitchenMapService;
    this.vocabularyService = deps.vocabularyService;
    this.agentToolsEnabled = deps.agentToolsEnabled ?? false;
    this.momentRepository = deps.momentRepository;
    this.childAllergensRepository = deps.childAllergensRepository;
    this.dietaryPreferencesRepository = deps.dietaryPreferencesRepository;
    this.foodPreferencesRepository = deps.foodPreferencesRepository;
    this.signalsService = deps.signalsService;
    this.householdRulesRepository = deps.householdRulesRepository;
    this.recipesRepository = deps.recipesRepository;
    this.onboardingChipSuggestionRepository = deps.onboardingChipSuggestionRepository;
    this.curatedBaseline = deps.curatedBaseline;
    this.catalogSeedQueue = deps.catalogSeedQueue;
    this.catalogProjection = deps.catalogProjection;
    this.householdAllergensRepository = deps.householdAllergensRepository;
    this.householdsRepository = deps.householdsRepository;
    this.turnRunner = new OnboardingTurnRunner({
      agent: this.agent,
      logger: this.logger,
      agentToolsEnabled: this.agentToolsEnabled,
      childrenService: this.childrenService,
      culturalPriorRepository: this.culturalPriorRepository,
      householdsService: this.householdsService,
      kitchenMapService: this.kitchenMapService,
      vocabularyService: this.vocabularyService,
      memoryService: this.memoryService,
      childAllergensRepository: this.childAllergensRepository,
      householdAllergensRepository: this.householdAllergensRepository,
      dietaryPreferencesRepository: this.dietaryPreferencesRepository,
      foodPreferencesRepository: this.foodPreferencesRepository,
      signalsService: this.signalsService,
      householdRulesRepository: this.householdRulesRepository,
      recipesRepository: this.recipesRepository,
    });
  }

  // Slice 2.7-s7 — the M5 personalized-chip projection, extracted from
  // submitTextTurn's moment block. Runs only at m5_starting_line (and not while
  // a prior cold-start's Stage 1 is still pending). Reads the cuisine / allergen
  // / required-dietary filters, each best-effort (a read failure just drops that
  // filter), then projects the per-household chip set. Returns the chips +
  // coldStartReason for the caller to fold into the persisted state; never
  // throws (a projection failure surfaces as `failed`, leaving chip_config null).
  /**
   * Idempotent Stage 1 enqueue. Safe to call at any checkpoint: it no-ops when
   * Stage 1 has already completed, and bounds itself with `stage1_attempts` so
   * a household whose seeding permanently fails cannot spin the queue.
   *
   * Fire-and-forget by contract — awaiting it would put an LLM-backed
   * background job on the interview's critical path. Every exit is logged;
   * the one thing this must never do is fail silently, which is exactly what
   * the previous `if (queue !== undefined)` guard did when the queue was
   * missing (no else, no log, household stranded forever).
   */
  private async ensureStage1Seeded(householdId: string): Promise<void> {
    if (this.catalogSeedQueue === undefined) {
      this.logger.error(
        { module: 'onboarding', action: 'stage1.queue_unavailable', household_id: householdId },
        'Stage 1 catalog seed queue is not wired — household will be stuck on the Stage 0 baseline',
      );
      return;
    }

    let attempts = 0;
    // Review follow-up (16-s1) — tracks whether `attempts` reflects a real read.
    // On a read failure we still enqueue (see below), but we must NOT write an
    // attempts count we don't actually know: doing so pinned stage1_attempts at
    // 1 forever whenever the read path was flaky, silently defeating
    // STAGE1_MAX_ATTEMPTS.
    let attemptsKnown = false;
    if (this.householdsRepository !== undefined) {
      try {
        const status = await this.householdsRepository.getStage1Status(householdId);
        // No household row — deleted mid-interview, or never provisioned.
        // Nothing to seed; abandon the ensure cleanly.
        if (status === null) return;
        if (status.completedAt !== null) return; // already seeded — nothing to do
        if (status.attempts >= STAGE1_MAX_ATTEMPTS) {
          this.logger.warn(
            {
              module: 'onboarding',
              action: 'stage1.attempts_exhausted',
              household_id: householdId,
              attempts: status.attempts,
            },
            'Stage 1 seeding has failed repeatedly — leaving the household on the Stage 0 baseline',
          );
          return;
        }
        attempts = status.attempts;
        attemptsKnown = true;
      } catch (err) {
        // A status read failure must not block the enqueue: seeding twice is
        // harmless (the service is idempotent on stage1_completed_at), never
        // seeding is not. It must also not touch the attempts count — see
        // attemptsKnown above.
        this.logger.warn(
          { err, module: 'onboarding', action: 'stage1.status_read_failed', household_id: householdId },
          'Stage 1 status read failed — enqueueing anyway',
        );
      }
    }

    try {
      // Slice 16-s1 — household-scoped dedup. Two checkpoints (m3_taste exit,
      // m5_starting_line entry) fire per interview and BullMQ will not dedup on
      // its own, so without this a healthy household enqueues twice.
      const jobId = `${CATALOG_SEED_QUEUE}:${householdId}`;
      const existing = await this.catalogSeedQueue.getJob(jobId);
      if (existing !== undefined && existing !== null) {
        const state = await existing.getState();
        // Still in flight — the first checkpoint's job will do the work. Return
        // WITHOUT incrementing: an attempt must track a job we actually created,
        // or the second checkpoint silently halves the retry budget.
        if (state !== 'completed' && state !== 'failed') {
          this.logger.info(
            {
              module: 'onboarding',
              action: 'stage1.enqueue_deduped',
              household_id: householdId,
              job_state: state,
            },
            'Stage 1 catalog seed already in flight — skipping duplicate enqueue',
          );
          return;
        }
        // Terminal. `removeOnComplete`/`removeOnFail` retain finished jobs, so
        // the id stays occupied; drop it or a household whose seed failed could
        // never be retried under the same jobId. STAGE1_MAX_ATTEMPTS still bounds
        // the loop.
        await existing.remove();
      }

      await this.catalogSeedQueue.add(
        'seed-catalog',
        { household_id: householdId, request_id: randomUUID() },
        { ...CATALOG_SEED_JOB_OPTS, jobId },
      );
      this.logger.info(
        {
          module: 'onboarding',
          action: 'stage1.enqueued',
          household_id: householdId,
          attempt: attempts + 1,
        },
        'Stage 1 catalog seed enqueued',
      );
      // Count the ENQUEUE, not the run: a job the worker never picks up must
      // still consume an attempt, or a dead worker means an unbounded loop.
      // Only write when we know the real baseline (attemptsKnown) — writing an
      // absolute value derived from a failed read would silently pin the
      // count. Isolated in its own try/catch: the job is already enqueued at
      // this point, so a write failure here is NOT an enqueue failure and must
      // not be logged or handled as one.
      if (attemptsKnown) {
        try {
          await this.householdsRepository?.incrementStage1Attempts(householdId, attempts + 1);
        } catch (err) {
          this.logger.error(
            {
              err,
              module: 'onboarding',
              action: 'stage1.attempts_increment_failed',
              household_id: householdId,
            },
            'Stage 1 catalog seed enqueued, but the attempts counter write failed',
          );
        }
      }
    } catch (err) {
      this.logger.error(
        { err, module: 'onboarding', action: 'stage1.enqueue_failed', household_id: householdId },
        'Stage 1 catalog seed job enqueue failed — onboarding turn not blocked',
      );
    }
  }

  private async runM5Projection(
    householdId: string,
    currentMoment: CurrentMoment,
    coldStartTriggered: boolean,
  ): Promise<{
    result: { chips: ChipOption[]; coldStartReason: string | null } | null;
    failed: boolean;
  }> {
    if (currentMoment !== 'm5_starting_line' || this.catalogProjection === undefined) {
      return { result: null, failed: false };
    }
    // Cold-start re-check: skip while Stage 1 is still pending (the quick
    // isStage1Complete() check avoids the full 5s poll on every repeated turn).
    const skipDueToColdStart =
      coldStartTriggered && !(await this.catalogProjection.isStage1Complete(householdId));
    if (skipDueToColdStart) {
      return { result: null, failed: false };
    }

    let declaredCuisineTags: string[] = [];
    if (this.culturalPriorRepository !== undefined) {
      try {
        const priors = await this.culturalPriorRepository.findByHousehold(householdId);
        declaredCuisineTags = priors.map((p) => p.key);
      } catch (err) {
        this.logger.warn(
          { err, module: 'onboarding', action: 'catalog.m5.cuisine_tag_read_failed', household_id: householdId },
          'cuisine tag read failed — per-cuisine floor check skipped',
        );
      }
    }

    let allergenFilter: string[] = [];
    if (this.householdAllergensRepository !== undefined) {
      try {
        const allergenRows = await this.householdAllergensRepository.findByHouseholdId(householdId);
        allergenFilter = allergenRows.map((r) => r.allergen);
      } catch (err) {
        this.logger.warn(
          { err, module: 'onboarding', action: 'catalog.m5.allergen_read_failed', household_id: householdId },
          'm5 allergen read failed — allergen filter skipped',
        );
      }
    }

    let requiredDietaryFlags: string[] = [];
    if (this.dietaryPreferencesRepository !== undefined) {
      try {
        const dietaryRows = await this.dietaryPreferencesRepository.findByHouseholdId(householdId);
        requiredDietaryFlags = dietaryRows
          .filter((r) => r.enforcement === 'non_negotiable')
          .map((r) => r.tag);
      } catch (err) {
        this.logger.warn(
          { err, module: 'onboarding', action: 'catalog.m5.dietary_read_failed', household_id: householdId },
          'm5 dietary read failed — dietary filter skipped',
        );
      }
    }

    try {
      const { chips, coldStartReason } = await this.catalogProjection.getM5Chips(
        householdId,
        declaredCuisineTags,
        allergenFilter,
        requiredDietaryFlags,
      );
      return { result: { chips, coldStartReason }, failed: false };
    } catch (err) {
      this.logger.warn(
        { err, module: 'onboarding', action: 'catalog.m5.projection_failed', household_id: householdId },
        'm5 personalized chips fetch failed — chip_config left as null',
      );
      return { result: null, failed: true };
    }
  }

  // Slice 2.7-s7 — chip-config assembly for the response, extracted from
  // submitTextTurn. Layers, in order: the base per-moment config, the M5
  // personalized catalog chips (or null in cold-start / empty / failed), the
  // controller's slot-derived M1 household-name hint swap (AC3), the M3
  // enforcement-ratification override, and the M5 override_fewer injection.
  private assembleChipConfig(args: {
    nextCurrentMoment: CurrentMoment;
    m5ProjectionResult: { chips: ChipOption[]; coldStartReason: string | null } | null;
    m5ProjectionFailed: boolean;
    controllerSlots: OnboardingSlots | null;
    ratificationRequested: boolean;
    coldStartTriggered: boolean;
    favoriteLunchCount: number;
    /** Children to offer as M2 attribution options; empty when nothing is pending. */
    attributionChildren: ReadonlyArray<{ id: string; name: string }>;
  }): ChipConfig | null {
    let chip_config: ChipConfig | null = momentToChipConfig(
      args.nextCurrentMoment,
      this.vocabularyService?.snapshot(),
    );

    // Slice 2.6-s4/s6 — M5 personalized chips from the cached projection. A
    // coldStartReason or an empty set renders no chip card; a projection failure
    // (m5ProjectionFailed) leaves the base config (null for M5) — degraded prose.
    if (args.nextCurrentMoment === 'm5_starting_line' && args.m5ProjectionResult !== null) {
      if (
        args.m5ProjectionResult.coldStartReason !== null ||
        args.m5ProjectionResult.chips.length === 0
      ) {
        chip_config = null;
      } else {
        chip_config = { mode: 'choice', options: args.m5ProjectionResult.chips };
      }
    }
    void args.m5ProjectionFailed;

    // Slice 2.7-s6 (AC3) — slot-derived M1 household-name hint swap (replaces the
    // [CHIP_PROMPT:household_name] sentinel). Skipped when the moment block did
    // not run (no momentRepository → controllerSlots null).
    if (args.controllerSlots !== null) {
      chip_config = this.controller.chipConfig(
        args.nextCurrentMoment,
        chip_config,
        args.controllerSlots,
      );
    }

    // Slice 2.7-s5 — a dietary.declare / cuisine.declare result asked for
    // enforcement ratification → show the 3-option action chips (no skip).
    if (args.ratificationRequested) {
      chip_config = RATIFICATION_CHIPS;
    }

    // M2 "who is this for?" — replaces the allergen chip set for the one turn
    // the follow-up is outstanding. Last of the M2-relevant overrides so it
    // wins over the base config; the controller has held the moment at m2_safe.
    if (
      args.controllerSlots?.m2AttributionPending === true &&
      args.attributionChildren.length > 0
    ) {
      chip_config = buildM2AttributionChips(args.attributionChildren);
    }

    // Slice 2.5-s9 / 2.6-s6 — inject the override_fewer control chip once the
    // parent has ≥4 favourites (≥1 in cold-start). chip_config is null in
    // cold-start (no chip card), so this no-ops there.
    const overrideThreshold = args.coldStartTriggered ? 1 : 4;
    if (
      args.nextCurrentMoment === 'm5_starting_line' &&
      args.favoriteLunchCount >= overrideThreshold &&
      chip_config !== null &&
      chip_config.mode === 'choice' &&
      chip_config.options !== undefined
    ) {
      chip_config = {
        ...chip_config,
        options: [...chip_config.options, { key: 'override_fewer', label: 'Start with fewer' }],
      };
    }

    return chip_config;
  }

  async submitTextTurn(input: SubmitTextTurnInput): Promise<SubmitTextTurnResult> {
    // 1. Refuse if a closed onboarding thread already carries a summary
    //    (modality-agnostic — voice-completed households should not re-onboard
    //    via text).
    if (await this.householdHasCompletedOnboarding(input.householdId)) {
      throw new ConflictError('onboarding already complete');
    }

    // 2. Reuse the active text-modality thread or create one.
    //    R2-D1/R2-D2 — DB partial unique index on (household_id, type, modality)
    //    WHERE status='active' guarantees one active text thread; a concurrent
    //    first-turn race surfaces as a unique-violation that we map to 409.
    let thread: ThreadRow | null = await this.threads.findActiveThreadByHousehold(
      input.householdId,
      ONBOARDING_THREAD_TYPE,
      TEXT_MODALITY,
    );
    if (thread === null) {
      try {
        thread = await this.threads.createThread(
          input.householdId,
          ONBOARDING_THREAD_TYPE,
          TEXT_MODALITY,
        );
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Concurrent first-turn lost the race — read the winner's thread.
        thread = await this.threads.findActiveThreadByHousehold(
          input.householdId,
          ONBOARDING_THREAD_TYPE,
          TEXT_MODALITY,
        );
        if (thread === null) {
          throw new ConflictError('onboarding already complete');
        }
      }
    }

    // 3. Read the existing turns once — we need them for both the F16 gate,
    //    the F08 orphan check, and as agent history.
    const existingTurns = await this.threads.listTurns(thread.id);

    // Slice 2-S26 — resume detection. A real-message turn already on the
    // thread (excluding the synthetic OPENING_GREETING which lives only
    // client-side) means this call is a mid-conversation continuation, not
    // turn 1. Surface to the route so it can write the onboarding.resumed
    // audit row. Computed BEFORE the orphan-recovery branch overwrites the
    // turn-list reasoning so the signal stays honest.
    const wasResumed = existingTurns.some(
      (t) =>
        t.body.type === 'message' && (t.role === 'user' || t.role === 'lumi'),
    );

    // F16 — an active thread that already carries a summary system_event
    // means the household is effectively done; refuse new turns rather than
    // continuing past the conversation's natural end.
    if (
      existingTurns.some(
        (t) => t.body.type === 'system_event' && t.body.event === SUMMARY_EVENT,
      )
    ) {
      throw new ConflictError('onboarding already complete');
    }

    const history = this.turnsToLlmMessages(existingTurns);

    // F08 / R2-P1 — orphaned user turn: a previous attempt persisted the user
    //   turn then failed before Lumi's reply was written (AC7 contract). On
    //   the client retry we must NOT append a duplicate user turn — instead
    //   resume the conversation by treating the existing trailing user turn
    //   as the input for this request. R2-P1 — only resume when the new
    //   `input.message` matches the stored content; otherwise the client is
    //   sending a different (possibly edited) message, in which case we
    //   append a fresh user turn so the agent sees what the user actually
    //   sent and the returned turn_id matches the optimistic UI.
    // P6: strip any [NEXT_MOMENT:...] directives injected by a crafted client
    // before the message reaches the agent or the thread store. The directive
    // protocol is server→agent only; user input must never carry it.
    const userMessage = input.message
      .replace(/\[NEXT_MOMENT:[a-z0-9_]+\]/g, '')
      .replace(/\[CHIP_PROMPT:elevation:[a-z0-9_]+:[^\]]+\]/g, '')
      .trim();

    // M5 chip UUID resolution: the M5 chip card uses either a generated
    // suggestion id or a declared-favourite recipe id as chip keys. When the
    // parent selects chips, the client sends those UUIDs in the
    // [Chips selected: ...] header. Resolve them to display labels here,
    // before the DB write and the agent call, so:
    //   a) the stored turn has readable names (conversation history stays clean)
    //   b) the agent receives readable names it can pass to favorite_lunch.add
    // Detection: UUID shape distinguishes M5 chip keys from all other moment
    // chip keys (allergen slugs, cuisine slugs, bag patterns, etc. are short
    // human-readable tokens — never UUID-shaped).
    //
    // Slice 16-s1 (AC 5) — resolution order is suggestions FIRST, recipes
    // SECOND. Generated-suggestion chips have no recipes row at all; a lookup
    // that only checked recipes would return null and pass the raw UUID
    // through to the agent, which calls favorite_lunch.add("<uuid>") and
    // creates a recipe literally named after it — no error, no log,
    // permanently wrong data. Key spaces stay separate (suggestion ids never
    // collide with recipe ids), so checking both is safe and unambiguous.
    let resolvedUserMessage = userMessage;
    if (this.recipesRepository !== undefined || this.onboardingChipSuggestionRepository !== undefined) {
      const chipKeys = parseChipKeys(userMessage);
      const uuidChipKeys = chipKeys.filter((k) => UUID_RE.test(k));
      if (uuidChipKeys.length > 0) {
        const suggestionRepo = this.onboardingChipSuggestionRepository;
        const recipesRepo = this.recipesRepository;
        const resolvedNames = new Map<string, string>();
        await Promise.all(
          uuidChipKeys.map(async (uuid) => {
            try {
              const suggestion = await suggestionRepo?.findById(uuid);
              if (suggestion !== null && suggestion !== undefined) {
                resolvedNames.set(uuid, suggestion.label);
                return;
              }
              const recipe = await recipesRepo?.findById(uuid);
              if (recipe !== null && recipe !== undefined) {
                resolvedNames.set(uuid, recipe.canonical_name);
                return;
              }
              this.logger.warn(
                {
                  module: 'onboarding',
                  action: 'onboarding.m5_chip_uuid_unresolved',
                  household_id: input.householdId,
                  uuid,
                },
                'm5 chip UUID resolved to nothing in either store — keeping UUID in message',
              );
            } catch (err) {
              this.logger.warn(
                {
                  err,
                  module: 'onboarding',
                  action: 'onboarding.m5_chip_uuid_resolve_failed',
                  household_id: input.householdId,
                  uuid,
                },
                'm5 chip UUID resolution failed — keeping UUID in message',
              );
            }
          }),
        );
        if (resolvedNames.size > 0) {
          resolvedUserMessage = userMessage.replace(
            /\[Chips selected:\s*([^\]]+)\]/,
            (_: string, inner: string) => {
              const resolved = inner
                .split(',')
                .map((k) => k.trim())
                .map((k) => resolvedNames.get(k) ?? k);
              return `[Chips selected: ${resolved.join(', ')}]`;
            },
          );
          this.logger.info(
            {
              module: 'onboarding',
              action: 'onboarding.m5_chip_uuid_resolved',
              household_id: input.householdId,
              resolved_count: resolvedNames.size,
            },
            'm5 chip UUIDs resolved to canonical names',
          );
        }
      }
    }

    const lastTurn: TurnRow | undefined = existingTurns[existingTurns.length - 1];
    const isOrphanedUserTurn =
      lastTurn !== undefined &&
      lastTurn.role === 'user' &&
      lastTurn.body.type === 'message' &&
      lastTurn.body.content === resolvedUserMessage;

    let userTurn: TurnRow;
    let agentInput: LlmMessage[];
    if (isOrphanedUserTurn && lastTurn !== undefined) {
      userTurn = lastTurn;
      agentInput = history;
      this.logger.info(
        {
          module: 'onboarding',
          action: 'onboarding.resume_orphaned_turn',
          thread_id: thread.id,
          orphan_turn_id: lastTurn.id,
        },
        'resuming onboarding from orphaned user turn',
      );
    } else {
      // 4. Persist the user turn FIRST. If the agent fails afterwards (AC7),
      //    the user turn is on disk and the client retries the same content.
      userTurn = await this.threads.appendTurnNext({
        threadId: thread.id,
        role: 'user',
        body: { type: 'message', content: resolvedUserMessage },
        modality: TEXT_MODALITY,
      });
      agentInput = [...history, { role: 'user', content: resolvedUserMessage }];
    }

    // R2-P5 — first text turn has no agent-side history of the opening
    // greeting (it's rendered client-only). Without a prior assistant turn
    // the LLM commonly re-introduces itself on turn 2, breaking parity with
    // the voice flow. Prepend a synthetic greeting message so the agent
    // sees the same conversational entry point the user did.
    if (history.length === 0) {
      agentInput = [
        { role: 'assistant', content: OPENING_GREETING },
        ...agentInput,
      ];
    }

    // 5. Call the agent — translate any failure into UpstreamError (502).
    //    R2-P7 — do NOT echo the upstream error message into the response
    //    detail field; OpenAI errors can leak request bodies, headers, and
    //    rate-limit JSON. Log the raw err server-side, return a generic
    //    detail to the client.
    //
    //    Slice C — when the tool loop is available, build per-turn tool
    //    specs (closure-captured householdId/userId) plus a Kitchen Map +
    //    Vocabulary system block. The agent then writes structured data to
    //    the household DB as it talks. When the loop isn't available, fall
    //    through to the legacy single-shot respond() — behaviour identical
    //    to pre-slice-C.
    // Slice 2.5-s4 — read moment state BEFORE the turn runs so the system
    // prompt can carry current_moment + required_set_status. Null = no row
    // yet (pre_start). Captured outside the runner so the post-turn upsert can
    // diff against it.
    let preTurnMomentState: MomentState | null = null;
    // Slice 2.7-s3 — the moment state written back at the end of the turn,
    // captured for the per-turn trace (moment-state "after"). Stays null when
    // no moment row is computed (no momentRepository). NOTE: this is assigned
    // before the upsert await, so on a failed DB write the trace records the
    // INTENDED state, not committed state (deferred D-2.7S3-CR2) — the Pino
    // logs remain authoritative for the committed result.
    let postTurnMomentState: MomentState | null = null;
    if (this.momentRepository !== undefined) {
      try {
        preTurnMomentState = await this.momentRepository.getState(input.householdId);
      } catch (err) {
        // Defensive: a read failure should not fail the turn — the agent
        // will see pre_start defaults and the post-turn upsert may still
        // succeed. Log and proceed.
        this.logger.warn(
          {
            err,
            module: 'onboarding',
            action: 'onboarding.moment_state_read_failed',
            household_id: input.householdId,
          },
          'moment state read failed — defaulting to pre_start',
        );
      }
    }
    // Chip parse — shared by the turn runner (pure-chip eligibility) and the
    // moment block below (the controller's slot signals).
    const submittedChipKeys = parseChipKeys(userMessage);
    const chipFreeText = userMessage.replace(/\[Chips selected:\s*[^\]]+\]/, '').trim();
    const preTurnMoment: CurrentMoment = preTurnMomentState?.current_moment ?? 'pre_start';

    // Slice 2.7-s7 — run the stateless turn function: assemble the prompt blocks,
    // call the provider (or apply a zero-call chip turn), execute tools, detect
    // ratification. Owns no control flow; the controller derives the next moment
    // from slot state below. A provider failure surfaces as UpstreamError (502).
    const exec = await this.turnRunner.run({
      householdId: input.householdId,
      userId: input.userId,
      threadId: thread.id,
      agentInput,
      submittedChipKeys,
      chipFreeText,
      preTurnMoment,
      preTurnMomentState,
    });
    const toolCallsSummary = exec.toolCallsSummary;
    const agentUsage = exec.agentUsage;
    const householdDisplayName = exec.householdDisplayName;
    const ratificationRequested = exec.ratificationRequested;
    const m2AttributionFromTurn = exec.m2AttributionPending;
    const attributionChildren = exec.m2AttributionChildren ?? [];
    const tracedKitchenMapBlock = exec.blocks.kitchenMap;
    const tracedMomentStateBlock = exec.blocks.momentState;
    const tracedVocabularyBlock = exec.blocks.vocabulary;

    // Slice 2.7-s7 — defense-in-depth: strip any stray control sentinel the
    // prompt no longer instructs the model to emit, so nothing leaks to the
    // user. The [CHIP_PROMPT:household_name] M1 hint swap is slot-derived in the
    // controller's chipConfig output (AC3).
    const lumiTextWithoutDirective = exec.lumiText
      .replace(NEXT_MOMENT_STRIP_RE, '')
      .replace(/\[CHIP_PROMPT:household_name\]/g, '')
      .replace(ELEVATION_SENTINEL_STRIP_RE, '')
      .trimEnd();

    // R2-P8 — defense-in-depth: TEXT_RULES instructs the model not to emit
    // expression tags, but rule-adherence is ~95%. Strip [warmly]/[pause]/etc.
    // before persisting and returning so a leak never surfaces literally to
    // the user.
    const sanitizedLumiText = stripExpressionTags(lumiTextWithoutDirective);

    // 6. Persist Lumi's reply.
    const lumiTurn = await this.threads.appendTurnNext({
      threadId: thread.id,
      role: 'lumi',
      body: { type: 'message', content: sanitizedLumiText },
      modality: TEXT_MODALITY,
    });

    // Slice 2.5-s4 — post-turn: compute the new moment state and write it
    // back. Best-effort: failures here log a warn and the turn still
    // returns successfully (the conversation can recover next turn).
    let nextCurrentMoment: CurrentMoment =
      preTurnMomentState?.current_moment ?? 'pre_start';
    // Hoisted so the post-moment-write chip-config block can decide whether
    // to inject the M5 'override_fewer' chip without re-querying. If the
    // moment-state read fails, the count stays at 0 (gate stays closed,
    // which is the safe fallback).
    let favoriteLunchCount = 0;
    // Slice 2.5-s10 — surfaced to the client so the summary moment can
    // enable/disable the finalize gate. null = no momentRepository wired
    // (legacy/test path); the gate falls back to the legacy isComplete CTA.
    let required_set_complete: boolean | null = null;
    let missing_required_set: string[] = [];
    // Slice 2.6-s6 — cold-start state. Carried forward from the pre-turn
    // row when present, then upgraded if this turn fires cold-start.
    // Sticky: once `coldStartTriggered` is true it never resets to false.
    let coldStartTriggered: boolean =
      preTurnMomentState?.cold_start_triggered ?? false;
    let coldStartTriggerReason: string | null =
      preTurnMomentState?.cold_start_trigger_reason ?? null;
    // Whether *this turn* discovered cold-start (drives the chip-config
    // branch + the carry-forward-vs-fresh telemetry log split).
    let coldStartTriggeredThisTurn = false;
    // Cached output of catalogProjection.getM5Chips(): the projection runs
    // inside the moment block (so cold-start flags are known before upsert)
    // and the result is reused when chip_config is assembled below.
    // null = projection not run this turn; { chips: [], coldStartReason: null }
    // = projection succeeded with no chips (rare; healthy catalog but
    // diversity cap left zero).
    let m5ProjectionResult: { chips: ChipOption[]; coldStartReason: string | null } | null = null;
    let m5ProjectionFailed = false;
    // Slice 2.7-s6 — the slot state the shadow controller reads. Assembled
    // inside the moment block once the required-set is computed; null when the
    // moment block doesn't run (no momentRepository — the legacy/test path),
    // in which case the slot-derived chip swap (AC3) is skipped.
    let controllerSlots: OnboardingSlots | null = null;
    if (this.momentRepository !== undefined) {
      try {
        const counts = await this.momentRepository.countRequiredSetSources(
          input.householdId,
        );
        favoriteLunchCount = counts.favorite_lunch_count;
        const previousMoment: CurrentMoment =
          preTurnMomentState?.current_moment ?? 'pre_start';

        // ---- Slot model (Slice 2.7-s7) -------------------------------------
        // The controller advances the moment deterministically from slot state;
        // the [NEXT_MOMENT:] directive and the M3/M4/re-anchor/pre_start safety
        // nets it compensated for are gone. Slots are derived from persisted
        // data (counts) plus turn-local signals.

        // M2 (safety wall) — "allergen response given" is turn-local + sticky.
        // Household-wide chip allergens AND "no known allergens" both write zero
        // CHILD-scoped rows, so child_allergen_count can't see them; the parent
        // answering ANY way while in m2_safe is the signal the directive used to
        // carry. Once true it stays true (sticky via the carried-forward state).
        const m2AnsweredThisTurn =
          previousMoment === 'm2_safe' && userMessage.trim().length > 0;
        const m2_allergen_response =
          counts.child_allergen_count > 0 ||
          preTurnMomentState?.required_set_status.m2_allergen_response === true ||
          m2AnsweredThisTurn;

        // "Who is this for?" — set when an ambiguous allergen tap deferred its
        // declare, cleared when the parent answers. undefined from the runner
        // means this turn said nothing about it, so carry the pre-turn value.
        // A free-text turn while an ask is pending clears it: the parent
        // answered in prose, the model owns the declare, and holding the gate
        // on a question they already addressed would trap them in M2.
        const carriedAttribution =
          preTurnMomentState?.required_set_status.m2_attribution_pending ?? [];
        const m2_attribution_pending =
          m2AttributionFromTurn ??
          (previousMoment === 'm2_safe' && userMessage.trim().length > 0 ? [] : carriedAttribution);

        // M3 (optional) — answered via cuisine/dietary chips or an explicit skip,
        // this turn or a prior turn (reproduces the deleted M3 chip auto-advance).
        // A ratification turn (request_ratification on the tool result) is NOT an
        // answer — the parent must still pick an enforcement chip — so the moment
        // holds at m3_taste; the ratification chip the parent then taps IS an
        // answer and advances on the following turn.
        const m3ChipThisTurn =
          submittedChipKeys.length > 0 &&
          submittedChipKeys.every((k) => M3_CHIP_KEYS.has(k) || k === 'skip');
        const m3RatificationChipThisTurn =
          submittedChipKeys.length > 0 &&
          submittedChipKeys.every((k) => RATIFICATION_KEYS.has(k));
        const m3ChipPriorTurn = existingTurns.some(
          (t) =>
            t.role === 'user' &&
            t.body.type === 'message' &&
            parseChipKeys(t.body.content).some((k) => M3_CHIP_KEYS.has(k)),
        );
        const m3Answered =
          !ratificationRequested &&
          (m3ChipThisTurn || m3RatificationChipThisTurn || m3ChipPriorTurn);

        // M4 — bag-composition pattern chosen, this turn or a prior turn
        // (reproduces the deleted M4 chip auto-advance safety net).
        const m4ChipThisTurn =
          submittedChipKeys.length > 0 &&
          submittedChipKeys.every((k) => M4_BAG_CHIP_KEYS.has(k));
        const m4ChipPriorTurn = existingTurns.some(
          (t) =>
            t.role === 'user' &&
            t.body.type === 'message' &&
            parseChipKeys(t.body.content).some((k) => M4_BAG_CHIP_KEYS.has(k)),
        );
        const m4Answered = m4ChipThisTurn || m4ChipPriorTurn;

        // M5 (starting line) — complete via the FR124 count gate (≥10, relaxed
        // to 3 in cold-start), the override_fewer control chip (≥4, relaxed to 1
        // in cold-start), or sticky-once-true. coldStartTriggered here is the
        // carried-forward (pre-turn) value; a cold-start that FIRST fires this
        // turn relaxes the threshold from the next turn (count is ~0 on m5 entry,
        // so the same-turn relaxation never decides an advance).
        const m5OverrideFloor = coldStartTriggered ? 1 : 4;
        const m5OverrideThisTurn =
          previousMoment === 'm5_starting_line' &&
          submittedChipKeys.includes('override_fewer') &&
          counts.favorite_lunch_count >= m5OverrideFloor;
        const m5NaturalThreshold = coldStartTriggered ? 3 : 5;
        const m5_complete =
          counts.favorite_lunch_count >= m5NaturalThreshold ||
          m5OverrideThisTurn ||
          preTurnMomentState?.required_set_status.m5_complete === true;

        controllerSlots = {
          m1HouseholdName: counts.household_name_set,
          m1ChildDeclared: counts.child_count > 0,
          m2AllergenResponse: m2_allergen_response,
          m2AttributionPending: m2_attribution_pending.length > 0,
          m3Answered,
          m4Answered,
          m5Complete: m5_complete,
        };

        // The controller is authoritative for current_moment (AC2/AC3). With no
        // prior moment row (fresh / resumed / reset) it reconstructs from slot
        // state; otherwise it advances forward-only from the prior moment. Since
        // 13-s6 M3 is a REQUIRED moment, so re-anchor lands an M1+M2-complete
        // household ON m3_taste rather than skipping past it.
        // It caps at `summary` (finalize is the endpoint's responsibility).
        nextCurrentMoment =
          preTurnMomentState === null
            ? this.controller.reconstructMoment(controllerSlots)
            : this.controller.nextMoment(previousMoment, controllerSlots);

        // Slice 16-s1 — the Stage 1 seed fires when the controller leaves
        // m3_taste, NOT m2_safe. The old M2 edge ran the generation before the
        // parent had stated any taste, so the "personalised" catalog was built
        // from declared allergens plus an inferred cultural template only.
        const advancedOutOfM3 =
          previousMoment === 'm3_taste' && nextCurrentMoment !== 'm3_taste';

        // Slice 2.6-s6 — run the catalog projection BEFORE upsertState so a
        // fresh cold-start trigger this turn flows into the persisted flag and
        // into the relaxed (3 vs 10) m5_complete threshold next turn. The chips
        // are cached for the chip_config assembly below (2.7-s7 — extracted to a
        // focused helper).
        const proj = await this.runM5Projection(
          input.householdId,
          nextCurrentMoment,
          coldStartTriggered,
        );
        m5ProjectionResult = proj.result;
        m5ProjectionFailed = proj.failed;
        if (proj.result !== null && proj.result.coldStartReason !== null) {
          coldStartTriggeredThisTurn = true;
          coldStartTriggered = true;
          coldStartTriggerReason = proj.result.coldStartReason;
        }

        const requiredSetStatus: RequiredSetStatus = {
          m1_household_name: counts.household_name_set,
          m1_child_declared: counts.child_count > 0,
          m2_allergen_response,
          // Slice 13-s6 — M3 sticky-once-true: carry forward a prior true so a
          // re-anchored/later turn (which recomputes m3Answered from turn-local
          // signals) never clears an answered required-set bit.
          m3_answered:
            m3Answered ||
            preTurnMomentState?.required_set_status.m3_answered === true,
          m2_attribution_pending,
          m5_favorite_count: counts.favorite_lunch_count,
          m5_complete,
        };

        postTurnMomentState = {
          current_moment: nextCurrentMoment,
          required_set_status: requiredSetStatus,
          cold_start_triggered: coldStartTriggered,
          cold_start_trigger_reason: coldStartTriggerReason,
        };
        await this.momentRepository.upsertState(input.householdId, postTurnMomentState);

        // Slice 2.6-s6 — telemetry: log when cold-start is *active this
        // turn but was set in a prior turn* (the carry-forward case). The
        // first-time trigger log fires inside CatalogProjectionService.
        if (
          coldStartTriggered &&
          !coldStartTriggeredThisTurn
        ) {
          this.logger.info(
            {
              module: 'catalog',
              action: 'catalog.m5.cold_start_active',
              household_id: input.householdId,
              cold_start_trigger_reason: coldStartTriggerReason,
              favorite_lunch_count: counts.favorite_lunch_count,
            },
            'M5 cold-start mode active this turn',
          );
        }

        // Stage 1 catalog seeding. Checked at TWO points, not one: leaving
        // m3_taste (the earliest moment the parent's STATED taste is known) and
        // entering m5_starting_line (the moment the chips are actually needed).
        // A single edge-trigger means one missed edge — a reconstructed moment
        // that never stepped through the edge, an undefined queue, an LLM
        // timeout — strands the household on the Stage 0 rice baseline
        // permanently: nothing reconciles `stage1_completed_at IS NULL`, and
        // Stage 2 recovery cannot help because it skips any household already
        // holding >= 35 seeded rows, which the 50-row Stage 0 baseline always
        // satisfies. The two edges are deduped at the queue on a
        // household-scoped jobId, so a healthy interview enqueues exactly once.
        const stage1Checkpoint =
          advancedOutOfM3 ||
          (previousMoment !== 'm5_starting_line' &&
            nextCurrentMoment === 'm5_starting_line');
        if (stage1Checkpoint) {
          void this.ensureStage1Seeded(input.householdId);
        }

        // Slice 2.6-s2 — Trigger 2: parent just advanced OUT of m3_taste.
        // Fire-and-forget Stage 0 re-materialization with the cuisine tags
        // derived from the cultural_priors written during M3. Cultural keys
        // mixed into the array are harmless — the SQL `cuisine_tags &&`
        // overlap filter naturally drops any key that isn't in the
        // curated_baseline_items.cuisine_tags vocabulary.
        if (
          previousMoment === 'm3_taste' &&
          nextCurrentMoment !== 'm3_taste' &&
          this.curatedBaseline !== undefined &&
          this.culturalPriorRepository !== undefined
        ) {
          const curatedBaseline = this.curatedBaseline;
          const culturalPriorRepository = this.culturalPriorRepository;
          const householdId = input.householdId;
          const logger = this.logger;
          void (async (): Promise<void> => {
            try {
              const priors = await culturalPriorRepository.findByHousehold(householdId);
              const cuisineTags = priors.map((p) => p.key);
              await curatedBaseline.rematerialize(householdId, cuisineTags);
            } catch (err) {
              logger.error(
                {
                  module: 'onboarding',
                  action: 'stage0.rematerialize_kickoff_failed',
                  household_id: householdId,
                  err,
                },
                'stage 0 rematerialize promise rejected',
              );
            }
          })();
        }

        // Slice 2.5-s10 — surface required-set completion to the client.
        required_set_complete =
          requiredSetStatus.m1_household_name &&
          requiredSetStatus.m1_child_declared &&
          requiredSetStatus.m2_allergen_response &&
          requiredSetStatus.m3_answered &&
          requiredSetStatus.m5_complete;
        missing_required_set = [];
        if (
          !requiredSetStatus.m1_household_name ||
          !requiredSetStatus.m1_child_declared
        ) {
          missing_required_set.push('m1_table');
        }
        if (!requiredSetStatus.m2_allergen_response) {
          missing_required_set.push('m2_safe');
        }
        if (!requiredSetStatus.m3_answered) {
          missing_required_set.push('m3_taste');
        }
        if (!requiredSetStatus.m5_complete) {
          missing_required_set.push('m5_starting_line');
        }

        this.logger.info(
          {
            module: 'onboarding',
            action: 'onboarding.moment_state_updated',
            household_id: input.householdId,
            thread_id: thread.id,
            from_moment: previousMoment,
            to_moment: nextCurrentMoment,
            required_set_complete,
          },
          'onboarding moment state updated',
        );
      } catch (err) {
        // If the moment block fails on the very first turn (pre_start → nothing
        // written), nextCurrentMoment stays at 'pre_start', which produces a
        // null chip_config and an invisible conversation start.  Advance to
        // m1_table as a best-effort fallback so the client always renders the
        // M1 hint chips even when the DB is temporarily unavailable.
        if (nextCurrentMoment === 'pre_start') {
          nextCurrentMoment = 'm1_table';
        }
        this.logger.warn(
          {
            err,
            module: 'onboarding',
            action: 'onboarding.moment_state_write_failed',
            household_id: input.householdId,
            thread_id: thread.id,
          },
          'moment state upsert failed — turn returns without state advance',
        );
      }
    }

    // Slice 2.7-s7 — chip-config assembly extracted to a focused helper
    // (base config → M5 catalog chips → slot-derived M1 swap → ratification
    // override → M5 override_fewer injection).
    const chip_config = this.assembleChipConfig({
      nextCurrentMoment,
      m5ProjectionResult,
      m5ProjectionFailed,
      controllerSlots,
      ratificationRequested,
      coldStartTriggered,
      favoriteLunchCount,
      attributionChildren: attributionChildren,
    });

    // 7. Slice 2.7-s7 — completion eligibility is now the deterministic slot
    //    predicate, not the isSummaryConfirmed LLM classifier (AC2). The parent
    //    has reached the end when the controller has them at `summary` AND the
    //    required set is complete. This gates the client's Finalize affordance;
    //    it is eligibility, never auto-commit — the explicit Finalize tap still
    //    commits (AC5). When momentRepository is absent (legacy/test path)
    //    required_set_complete is null → is_complete stays false.
    const isComplete =
      nextCurrentMoment === 'summary' && required_set_complete === true;

    // Slice 2.7-s3 — per-turn agentic trace. Opt-in (ONBOARDING_TRACE_DIR);
    // when unset createOnboardingTracer returns undefined and the argument
    // below is never constructed (zero added work — AC2). The write is
    // fire-and-forget inside the tracer, so it never blocks the response (AC4).
    const tracer = createOnboardingTracer(
      { householdId: input.householdId, threadId: thread.id, turnIndex: existingTurns.length },
      this.logger,
    );
    void tracer?.write({
      kitchenMapBlock: tracedKitchenMapBlock,
      momentStateBlock: tracedMomentStateBlock,
      vocabularyBlock: tracedVocabularyBlock,
      toolCalls: toolCallsSummary ?? [],
      usage: agentUsage,
      momentBefore: preTurnMomentState,
      momentAfter: postTurnMomentState,
    });

    return {
      thread_id: thread.id,
      turn_id: userTurn.id,
      lumi_turn_id: lumiTurn.id,
      lumi_response: sanitizedLumiText,
      is_complete: isComplete,
      chip_config,
      moment_key: nextCurrentMoment,
      required_set_complete,
      missing_required_set,
      household_display_name: householdDisplayName,
      _was_resumed: wasResumed,
      cold_start_mode: coldStartTriggered,
    };
  }

  async finalizeTextOnboarding(input: {
    userId: string;
    householdId: string;
  }): Promise<FinalizeTextOnboardingResult> {
    // 1. Already finalised on a closed thread? 409.
    if (await this.householdHasCompletedOnboarding(input.householdId)) {
      throw new ConflictError('onboarding already complete');
    }

    // 2. Need an active text-modality thread to finalise.
    const thread = await this.threads.findActiveThreadByHousehold(
      input.householdId,
      ONBOARDING_THREAD_TYPE,
      TEXT_MODALITY,
    );
    if (thread === null) {
      throw new ConflictError('no active onboarding thread to finalize');
    }

    const turns = await this.threads.listTurns(thread.id);

    // F05 — idempotent: a concurrent finalize call may have already
    // appended the summary turn on this thread. Return that summary
    // (and ensure the thread is closed) instead of writing a duplicate.
    // Safety net for the in-memory race; the DB partial unique index
    // `thread_turns_one_summary_per_thread` is the authoritative guard.
    const existingSummaryTurn = turns.find(
      (t) => t.body.type === 'system_event' && t.body.event === SUMMARY_EVENT,
    );
    if (
      existingSummaryTurn !== undefined &&
      existingSummaryTurn.body.type === 'system_event'
    ) {
      const payload = existingSummaryTurn.body.payload as {
        cultural_templates?: unknown;
        palate_notes?: unknown;
        allergens_mentioned?: unknown;
        family_rhythms?: unknown;
      };
      const summary = {
        cultural_templates: onlyStrings(payload.cultural_templates),
        palate_notes: onlyStrings(payload.palate_notes),
        allergens_mentioned: onlyStrings(payload.allergens_mentioned),
        family_rhythms: onlyStrings(payload.family_rhythms),
      };
      await this.threads.closeThread(thread.id);
      // P2 patch — idempotent path also attempts the best-effort 'finalized'
      // write so a prior write failure is recoverable on retry.
      if (this.momentRepository !== undefined) {
        try {
          const currentState = await this.momentRepository.getState(input.householdId);
          if (currentState !== null && currentState.current_moment !== 'finalized') {
            await this.momentRepository.upsertState(input.householdId, {
              current_moment: 'finalized',
              required_set_status: currentState.required_set_status,
            });
          }
        } catch (err) {
          this.logger.warn(
            {
              err,
              module: 'onboarding',
              action: 'onboarding.finalize_moment_state_write_failed_idempotent',
              household_id: input.householdId,
            },
            'moment state finalized write failed on idempotent path — thread is already closed',
          );
        }
      }
      return { thread_id: thread.id, summary };
    }

    // F09 — no MIN_TURNS_BEFORE_FINALIZE magic. The only structurally
    // invalid case is a thread with zero turns; everything else is the
    // classifier's call.
    if (turns.length === 0) {
      // F17 — distinguish from the classifier-says-not-ready case.
      throw new ConflictError('no turns recorded — start the conversation first');
    }

    // 2.5-s10 — Required-set gate: the moment must be 'summary' and the
    // required-set must be complete before the thread can be closed. This
    // is the server-authoritative EPIC MVP WALL enforcement. Best-effort:
    // a momentRepository read failure logs a warn and proceeds with the
    // existing isSummaryConfirmed safety-net alone (P1 fix: readFailed flag
    // prevents the null check from incorrectly blocking on a transient DB error).
    let finalizeState: MomentState | null = null;
    if (this.momentRepository !== undefined) {
      let readFailed = false;
      try {
        finalizeState = await this.momentRepository.getState(input.householdId);
      } catch (err) {
        readFailed = true;
        this.logger.warn(
          {
            err,
            module: 'onboarding',
            action: 'onboarding.finalize_moment_state_read_failed',
            household_id: input.householdId,
          },
          'moment state read failed during finalize — proceeding with isSummaryConfirmed safety-net',
        );
      }
      if (!readFailed) {
        if (finalizeState === null || finalizeState.current_moment !== 'summary') {
          throw new ConflictError(
            'onboarding summary not reached — complete all five moments before finalizing',
          );
        }
        const rss = finalizeState.required_set_status;
        const reqComplete =
          rss.m1_household_name &&
          rss.m1_child_declared &&
          rss.m2_allergen_response &&
          rss.m3_answered &&
          rss.m5_complete;
        if (!reqComplete) {
          throw new ConflictError(
            'required fields incomplete — finish all required onboarding moments before finalizing',
          );
        }
      }
    }

    const history = this.turnsToLlmMessages(turns);

    // F06 — the LLM classifier is the safety net when the structured moment-
    // state gate could not run (momentRepository absent or DB read failed).
    // When the structured gate already passed (current_moment='summary' AND
    // required_set_complete=true), the parent tapping Finalize IS their
    // confirmation — skip the classifier to avoid blocking on an unanswered
    // "Does this sound right?" turn. The classifier still runs on the legacy
    // path (no moment tracking) and the read-failed fallback path.
    const structuredGatePassed =
      finalizeState !== null &&
      finalizeState.current_moment === 'summary' &&
      finalizeState.required_set_status.m1_household_name &&
      finalizeState.required_set_status.m1_child_declared &&
      finalizeState.required_set_status.m2_allergen_response &&
      finalizeState.required_set_status.m3_answered &&
      finalizeState.required_set_status.m5_complete;

    if (!structuredGatePassed) {
      let confirmed: boolean;
      try {
        confirmed = await this.agent.isSummaryConfirmed(history);
      } catch (err) {
        this.logger.error(
          {
            err,
            module: 'onboarding',
            action: 'onboarding.finalize_classifier_failed',
            thread_id: thread.id,
            household_id: input.householdId,
          },
          'isSummaryConfirmed failed during finalize — surfacing as upstream error',
        );
        throw new UpstreamError('Onboarding readiness check failed');
      }
      if (!confirmed) {
        // F17 — distinct message from the empty-thread case.
        throw new ConflictError('summary not yet confirmed — keep talking with Lumi');
      }
    }

    // 3. Run extraction. R2-P3 — on failure do NOT persist an empty summary
    //    and do NOT close the thread; surface as 502 so the client can retry.
    //    Silently writing an empty summary then closing causes permanent data
    //    loss for the household (downstream meal planning has no allergens).
    const transcript = turns
      .filter((t) => t.role !== 'system' && t.body.type === 'message')
      .map((t) => ({
        role: t.role === 'lumi' ? 'agent' : 'user',
        message: t.body.type === 'message' ? t.body.content : '',
      }));

    let summary: FinalizeTextOnboardingResult['summary'];
    try {
      summary = await this.agent.extractSummary(transcript);
    } catch (err) {
      this.logger.error(
        {
          err,
          module: 'onboarding',
          action: 'onboarding.summary_extraction_failed',
          thread_id: thread.id,
          household_id: input.householdId,
        },
        'onboarding summary extraction failed — refusing to persist empty summary',
      );
      throw new UpstreamError('Onboarding summary extraction failed');
    }

    // 4. Append the system_event summary turn (modality='text' — system
    //    events are not voice). The DB partial unique index guarantees only
    //    one summary per thread; a concurrent finalize race surfaces as a
    //    unique-violation that we map to a clean 409.
    let summaryTurn: TurnRow | null = null;
    try {
      summaryTurn = await this.threads.appendTurnNext({
        threadId: thread.id,
        role: 'system',
        body: {
          type: 'system_event',
          event: SUMMARY_EVENT,
          payload: summary,
        },
        modality: TEXT_MODALITY,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('onboarding already complete');
      }
      throw err;
    }

    // 5. Story 2.11 — infer cultural priors from the transcript and append a
    //    ratification_prompt turn. Wrapped in try/catch so finalisation never
    //    fails if cultural inference is degraded; silence-mode is the safe
    //    default (UX-DR46).
    try {
      await this.culturalPriorService.inferFromSummary({
        householdId: input.householdId,
        threadId: thread.id,
        transcript,
      });
    } catch (err) {
      this.logger.warn(
        {
          err,
          module: 'onboarding',
          action: 'onboarding.cultural_inference_failed',
          household_id: input.householdId,
          thread_id: thread.id,
        },
        'cultural prior inference failed during finalize — silence-mode fallback',
      );
    }

    // 6. Story 2.13 — seed visible memory nodes from the disclosed onboarding
    //    summary. Silence-mode: any failure is logged WARN and never blocks
    //    finalize (memory tier outage must not break onboarding).
    if (this.memoryService && summaryTurn !== null) {
      try {
        const { nodeCount } = await this.memoryService.seedFromOnboarding({
          householdId: input.householdId,
          userId: input.userId,
          threadId: thread.id,
          summaryTurnId: summaryTurn.id,
          summary,
        });
        if (nodeCount > 0) {
          this.logger.info(
            {
              module: 'onboarding',
              action: 'onboarding.memory_seeded',
              household_id: input.householdId,
              thread_id: thread.id,
              node_count: nodeCount,
            },
            'memory nodes seeded from onboarding',
          );
        }
      } catch (err) {
        this.logger.warn(
          {
            err,
            module: 'onboarding',
            action: 'onboarding.memory_seed_failed',
            household_id: input.householdId,
            thread_id: thread.id,
          },
          'memory seed failed during finalize — silence-mode fallback',
        );
      }
    }

    // 7. Close the thread.
    await this.threads.closeThread(thread.id);

    // 2.5-s10 — Mark moment state as finalized. Best-effort: a failure here
    // does not block the successful finalize response — the thread is
    // already closed (the authoritative is_onboarded signal) and moment
    // state is a secondary projection.
    if (this.momentRepository !== undefined && finalizeState !== null) {
      try {
        await this.momentRepository.upsertState(input.householdId, {
          current_moment: 'finalized',
          required_set_status: finalizeState.required_set_status,
        });
      } catch (err) {
        this.logger.warn(
          {
            err,
            module: 'onboarding',
            action: 'onboarding.finalize_moment_state_write_failed',
            household_id: input.householdId,
          },
          'moment state finalized write failed — thread is closed, is_onboarded still true',
        );
      }
    }

    this.logger.info(
      {
        module: 'onboarding',
        action: 'onboarding.completed',
        modality: 'text',
        household_id: input.householdId,
        user_id: input.userId,
        thread_id: thread.id,
        turn_count: turns.length + 1,
      },
      'text onboarding finalised',
    );

    // Slice 2.6-s6 — under-floor telemetry: a cold-start household that
    // finalized with fewer than 3 declared items used the override path.
    // Tracking this lets ops measure how often Lumi enters "less than a
    // starting line" mode.
    if (
      finalizeState !== null &&
      finalizeState.cold_start_triggered === true &&
      finalizeState.required_set_status.m5_favorite_count < 3
    ) {
      this.logger.info(
        {
          module: 'catalog',
          action: 'catalog.m5.cold_start_under_floor',
          household_id: input.householdId,
          favorite_lunch_count: finalizeState.required_set_status.m5_favorite_count,
        },
        'M5 finalized in cold-start mode below 3-item floor (override taken)',
      );
    }

    return { thread_id: thread.id, summary };
  }

  // Slice 2-S26 — three-state read for GET /v1/onboarding/state.
  //
  // Rules:
  //   - completed: there's a CLOSED onboarding thread with a summary turn.
  //     We deliberately do NOT check the 2-S19 derivation (parental notice +
  //     children) here — the page reaches this endpoint only when the user
  //     was routed in by !is_onboarded, so the only "completed" we care about
  //     surfacing is the rare case of a stale closed-thread race.
  //   - in_progress: ACTIVE onboarding thread exists and has ≥1 real (user
  //     or lumi message) turn. A brand-new active thread with zero turns is
  //     treated as not_started so the user gets the normal mode-picker UI.
  //     (Stripe-test/seed scripts can create empty active threads; the resume
  //     UI would otherwise greet them with an empty transcript.)
  //   - not_started: anything else.
  //
  // The synthetic OPENING_GREETING is excluded from the returned turns array
  // because it's a client-render constant — see onboarding.ts in contracts.
  async getState(householdId: string): Promise<OnboardingStateResult> {
    // 1. Closed thread with a summary turn → completed.
    if (await this.householdHasCompletedOnboarding(householdId)) {
      return { status: 'completed' };
    }

    // 2. Active onboarding thread? Try text first, then voice. Modality is
    //    informational so the UI can label the resume offer correctly.
    let thread = await this.threads.findActiveThreadByHousehold(
      householdId,
      ONBOARDING_THREAD_TYPE,
      'text',
    );
    if (thread === null) {
      thread = await this.threads.findActiveThreadByHousehold(
        householdId,
        ONBOARDING_THREAD_TYPE,
        'voice',
      );
    }
    if (thread === null) {
      return { status: 'not_started' };
    }

    const turns = await this.threads.listTurns(thread.id);

    // F16 — a summary turn on an active thread (concurrent finalize race
    // mid-flight) means the household is effectively done; close out the UI
    // gracefully.
    if (turns.some((t) => t.body.type === 'system_event' && t.body.event === SUMMARY_EVENT)) {
      return { status: 'completed' };
    }

    // Empty thread (no real turns yet): treat as not_started so the mode
    // picker renders rather than an empty "pick up where you left off" card.
    const messageTurns = turns.filter(
      (t): t is TurnRow & { body: { type: 'message'; content: string } } =>
        t.body.type === 'message' && (t.role === 'user' || t.role === 'lumi'),
    );
    if (messageTurns.length === 0) {
      return { status: 'not_started' };
    }

    const lastTurn = messageTurns[messageTurns.length - 1]!;

    let householdDisplayName: string | null = null;
    if (this.kitchenMapService) {
      try {
        const map = await this.kitchenMapService.get(householdId);
        householdDisplayName = map.household.display_name ?? null;
      } catch {
        // Non-fatal: panel falls back to regex heuristic
      }
    }

    let currentMoment: string | null = null;
    let chipConfig: ChipConfig | null = null;
    if (this.momentRepository !== undefined) {
      try {
        const momentState = await this.momentRepository.getState(householdId);
        currentMoment = momentState?.current_moment ?? null;
        const validMoment = parseMomentKey(currentMoment);
        if (validMoment !== null) {
          chipConfig = momentToChipConfig(validMoment, this.vocabularyService?.snapshot());
        }
      } catch {
        // Non-fatal: client restores chips on next turn
      }
    }

    return {
      status: 'in_progress',
      thread_id: thread.id,
      modality: thread.modality,
      started_at: thread.created_at,
      last_activity_at: lastTurn.created_at,
      turns: messageTurns.map((t) => ({
        id: t.id,
        role: t.role as 'user' | 'lumi',
        content: t.body.content,
        created_at: t.created_at,
      })),
      household_display_name: householdDisplayName,
      current_moment: currentMoment,
      chip_config: chipConfig,
    };
  }

  // Slice 2-S26 — close the active onboarding thread so the next attempt
  // starts fresh. Idempotent: no-op when there's no active thread.
  // Returns the closed thread's id (or null) so the caller can attach it to
  // the audit row metadata.
  async resetState(householdId: string): Promise<OnboardingResetResult> {
    const text = await this.threads.findActiveThreadByHousehold(
      householdId,
      ONBOARDING_THREAD_TYPE,
      'text',
    );
    const voice =
      text === null
        ? await this.threads.findActiveThreadByHousehold(
            householdId,
            ONBOARDING_THREAD_TYPE,
            'voice',
          )
        : null;
    const thread = text ?? voice;
    if (thread === null) {
      return { closed_thread_id: null };
    }

    // Append a system_event marker so the prior thread carries the reason
    // for closure in its turn history. Useful for ops debugging without
    // having to cross-reference audit rows.
    try {
      await this.threads.appendTurnNext({
        threadId: thread.id,
        role: 'system',
        body: { type: 'system_event', event: 'onboarding.reset', payload: { event_type: 'reset_by_user' } },
        modality: thread.modality,
      });
    } catch (err) {
      // Best-effort marker; the thread close below is the authoritative
      // signal. Log + proceed so an event-write failure doesn't strand
      // the user on the Resume surface.
      this.logger.warn(
        {
          err,
          module: 'onboarding',
          action: 'onboarding.reset_marker_failed',
          household_id: householdId,
          thread_id: thread.id,
        },
        'onboarding reset marker write failed — proceeding to close',
      );
    }

    await this.threads.closeThread(thread.id);
    return { closed_thread_id: thread.id };
  }

  // Has the household already produced a system_event 'onboarding.summary'
  // turn on a CLOSED onboarding thread (any modality)? AC9 gate. Active-
  // thread summary checks live inline at the call sites (F16) so we don't
  // have to read the active turns twice.
  private async householdHasCompletedOnboarding(householdId: string): Promise<boolean> {
    const closed = await this.threads.findClosedThreadByHousehold(
      householdId,
      ONBOARDING_THREAD_TYPE,
    );
    if (closed === null) return false;
    const turns = await this.threads.listTurns(closed.id);
    return turns.some(
      (t) => t.body.type === 'system_event' && t.body.event === SUMMARY_EVENT,
    );
  }

  private turnsToLlmMessages(turns: TurnRow[]): LlmMessage[] {
    const out: LlmMessage[] = [];
    for (const t of turns) {
      if (t.body.type !== 'message') continue;
      if (t.role === 'user') out.push({ role: 'user', content: t.body.content });
      else if (t.role === 'lumi') out.push({ role: 'assistant', content: t.body.content });
    }
    return out;
  }
}
