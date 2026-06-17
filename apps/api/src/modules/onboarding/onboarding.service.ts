import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Queue } from 'bullmq';
import { OPENING_GREETING, M1_HINT_CHIPS, type ChipConfig, type ChipOption } from '@hivekitchen/contracts';
import type { KitchenMap } from '@hivekitchen/types';
import {
  CATALOG_SEED_JOB_OPTS,
  type CatalogSeedJobData,
} from '../../jobs/catalog-seed.job.js';
import { ConflictError, UpstreamError } from '../../common/errors.js';
import { stripExpressionTags } from '../../common/strip-expression-tags.js';
import type { OnboardingAgent, LlmMessage } from '../../agents/onboarding.agent.js';
import { createOnboardingToolSpecs } from '../../agents/tools/onboarding.tools.js';
import type { ChildAllergensRepository } from '../children/child-allergens.repository.js';
import type { ChildrenService } from '../children/children.service.js';
import type { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import type { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';
import type { DietaryPreferencesRepository } from '../dietary-preferences/dietary-preferences.repository.js';
import type { FoodPreferencesRepository } from '../food-preferences/food-preferences.repository.js';
import type { RecipesRepository } from '../recipe/recipes.repository.js';
import type { HouseholdRulesRepository } from '../household-rules/household-rules.repository.js';
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
  householdRulesRepository?: HouseholdRulesRepository;
  // Slice 2.6-s1 — replaces favoriteLunchesRepository (2.5-s9). The M5 hot
  // path now writes to the canonical recipes catalog via RecipesRepository
  // .declareForHousehold(); the standalone favorite_lunches table is dropped
  // by migration 20260908000200.
  recipesRepository?: RecipesRepository;
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

interface ElevationPrompt {
  tag_key: string;
  tag_label: string;
}

// M3 chip keys — the full set of cuisine/dietary keys the parent can tap in
// moment 3. Used by the M3 auto-advance safety net to detect when the agent
// forgot to emit [NEXT_MOMENT:m4_bag] after a chip submission.
const M3_CHIP_KEYS = new Set([
  'halal', 'kosher', 'vegetarian', 'vegan', 'pescatarian', 'gluten_free', 'dairy_free',
  'south_indian', 'north_indian', 'east_african', 'caribbean', 'levantine', 'italian',
  'mexican', 'japanese', 'chinese', 'mediterranean',
]);

// M4 bag chip keys — the four bag-composition patterns the parent can select
// in moment 4. Used by the M4 auto-advance safety net.
const M4_BAG_CHIP_KEYS = new Set([
  'main_only', 'main_plus_snack', 'main_plus_extra', 'main_plus_snack_plus_extra',
]);

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

// M1 household-name hint chips — swapped in when Lumi emits
// [CHIP_PROMPT:household_name] while asking "What should I call your household?"
const HOUSEHOLD_NAME_HINT_CHIPS: ChipConfig = {
  mode: 'hint',
  hints: ['Menon Kitchen', 'The Khan Family', 'Smith Household'],
};

// Slice 2.5-s7 — optional M3-only elevation directive emitted alongside the
// regular [NEXT_MOMENT:] when the parent's language signals strong enforcement
// and the agent wants explicit ratification. Format:
//   [CHIP_PROMPT:elevation:<tag_key>:<tag_label>]
// Regex is created inside the function (not module-scope) to avoid /g flag
// lastIndex statefulness if exec/test were ever added to the call path.
function extractElevationPrompt(text: string): {
  cleaned: string;
  prompt: ElevationPrompt | null;
} {
  const re = /\[CHIP_PROMPT:elevation:([a-z0-9_]+):([^\]]+)\]/g;
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return { cleaned: text, prompt: null };
  // Last directive wins when duplicates leak — matches the [NEXT_MOMENT:] policy.
  const last = matches[matches.length - 1]!;
  const cleaned = text.replace(re, '').trimEnd();
  return {
    cleaned,
    prompt: { tag_key: last[1]!, tag_label: last[2]!.trim() },
  };
}

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

// Slice 2.5-s4 — chip_config per current_moment. All moments return null in
// this slice. Slices 2.5-s5 through 2.5-s9 each replace their respective
// branch with the real chip set. Kept as a switch so the moment slices'
// diffs are tiny and self-contained.
export function momentToChipConfig(moment: CurrentMoment): ChipConfig | null {
  switch (moment) {
    case 'm1_table':
      return M1_HINT_CHIPS;
    case 'm2_safe':
      // Slice 2.5-s6 — M2 is the safety wall: multi-select allergen chips
      // with an explicit "No known allergens" exclusive option. Labels copied
      // verbatim from Moment2Page.tsx; the client enforces 'none' mutual
      // exclusion. NO skip_label — M2 is REQUIRED.
      return {
        mode: 'choice',
        options: [
          { key: 'none', label: 'No known allergens' },
          { key: 'peanut', label: 'Peanut' },
          { key: 'tree_nut', label: 'Tree nuts' },
          { key: 'dairy', label: 'Dairy' },
          { key: 'egg', label: 'Eggs' },
          { key: 'soy', label: 'Soy' },
          { key: 'wheat', label: 'Wheat / gluten' },
          { key: 'fish', label: 'Fish' },
          { key: 'shellfish', label: 'Shellfish' },
          { key: 'sesame', label: 'Sesame' },
        ],
      };
    case 'm3_taste':
      // M3 — multi-select dietary + cuisine choice chips. Keys match the
      // vocabulary table keys that dietary.declare and cuisine.declare accept.
      // Parent taps any that apply (optionally adds free text); the agent
      // fires the appropriate tool per chip key. M3 is optional, so
      // skip_label remains first-class.
      return {
        mode: 'choice',
        options: [
          // Dietary identity
          { key: 'halal', label: 'Halal' },
          { key: 'kosher', label: 'Kosher' },
          { key: 'vegetarian', label: 'Vegetarian' },
          { key: 'vegan', label: 'Vegan' },
          { key: 'pescatarian', label: 'Pescatarian' },
          { key: 'gluten_free', label: 'Gluten-free' },
          { key: 'dairy_free', label: 'Dairy-free' },
          // Cuisine identity
          { key: 'south_indian', label: 'South Indian' },
          { key: 'north_indian', label: 'North Indian' },
          { key: 'east_african', label: 'East African' },
          { key: 'caribbean', label: 'Caribbean' },
          { key: 'levantine', label: 'Levantine' },
          { key: 'italian', label: 'Italian' },
          { key: 'mexican', label: 'Mexican' },
          { key: 'japanese', label: 'Japanese' },
          { key: 'chinese', label: 'Chinese' },
          { key: 'mediterranean', label: 'Mediterranean' },
        ],
        skip_label: 'Skip this moment',
      };
    case 'm4_bag':
      // Slice 2.5-s8 — M4 is a required-response gate (no skip_label) that
      // captures the parent's bag composition pattern. The 4 chip keys mirror
      // BagCompositionPatternSchema exactly so the agent can pass the
      // selection straight into child.upsert without re-mapping. Single-
      // select (mode: 'action').
      return {
        mode: 'action',
        options: [
          { key: 'main_only', label: 'Main only' },
          { key: 'main_plus_snack', label: 'Main + snack' },
          { key: 'main_plus_extra', label: 'Main + sides' },
          { key: 'main_plus_snack_plus_extra', label: 'Full bag' },
        ],
      };
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

// F10 — three signal questions × user/lumi pair = 6 LLM messages minimum
// before the summary turn is plausible (the synthetic greeting prepended to
// agentInput on first turn counts toward this). Below this we skip the
// OpenAI classifier call entirely (saves a per-turn round-trip in the early
// conversation). R2-P9 — also enforced inside the agent so the finalize path
// cannot bypass it via direct API call.
const MIN_TURNS_FOR_COMPLETION_CHECK = 6;

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
  private readonly householdRulesRepository?: HouseholdRulesRepository;
  // Slice 2.6-s1 (replaces 2.5-s9 favoriteLunchesRepository)
  private readonly recipesRepository?: RecipesRepository;
  // Slice 2.6-s2 — Stage 0 catalog re-seed at M3 exit
  private readonly curatedBaseline?: CuratedBaselineMaterializationService;
  // Slice 2.6-s3 — Stage 1 catalog seed fire-and-forget queue at M2 exit
  private readonly catalogSeedQueue?: Queue<CatalogSeedJobData>;
  // Slice 2.6-s4 — M5 personalized chip projection
  private readonly catalogProjection?: CatalogProjectionService;
  // M5 personalization — allergen filter
  private readonly householdAllergensRepository?: HouseholdAllergensRepository;

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
    this.householdRulesRepository = deps.householdRulesRepository;
    this.recipesRepository = deps.recipesRepository;
    this.curatedBaseline = deps.curatedBaseline;
    this.catalogSeedQueue = deps.catalogSeedQueue;
    this.catalogProjection = deps.catalogProjection;
    this.householdAllergensRepository = deps.householdAllergensRepository;
  }

  /**
   * Slice C — true when all four tool-loop deps are present and the env flag
   * is on. When false the service uses the legacy single-shot agent path.
   */
  private get toolLoopAvailable(): boolean {
    return (
      this.agentToolsEnabled &&
      this.childrenService !== undefined &&
      this.culturalPriorRepository !== undefined &&
      this.householdsService !== undefined &&
      this.kitchenMapService !== undefined &&
      this.vocabularyService !== undefined &&
      this.memoryService !== undefined &&
      this.childAllergensRepository !== undefined &&
      this.householdAllergensRepository !== undefined &&
      this.dietaryPreferencesRepository !== undefined &&
      this.foodPreferencesRepository !== undefined &&
      this.householdRulesRepository !== undefined &&
      this.recipesRepository !== undefined
    );
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

    // M5 chip UUID resolution: the M5 chip card uses recipe IDs (UUIDs) as
    // chip keys. When the parent selects chips, the client sends those UUIDs
    // in the [Chips selected: ...] header. Resolve them to canonical recipe
    // names here, before the DB write and the agent call, so:
    //   a) the stored turn has readable names (conversation history stays clean)
    //   b) the agent receives readable names it can pass to favorite_lunch.add
    // Detection: UUID shape distinguishes M5 recipe keys from all other moment
    // chip keys (allergen slugs, cuisine slugs, bag patterns, etc. are short
    // human-readable tokens — never UUID-shaped).
    let resolvedUserMessage = userMessage;
    if (this.recipesRepository !== undefined) {
      const chipKeys = parseChipKeys(userMessage);
      const uuidChipKeys = chipKeys.filter((k) => UUID_RE.test(k));
      if (uuidChipKeys.length > 0) {
        const recipesRepo = this.recipesRepository;
        const resolvedNames = new Map<string, string>();
        await Promise.all(
          uuidChipKeys.map(async (uuid) => {
            try {
              const recipe = await recipesRepo.findById(uuid);
              if (recipe !== null) resolvedNames.set(uuid, recipe.canonical_name);
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
    let lumiText: string;
    let toolCallsSummary: Array<{ tool: string; error: boolean }> | undefined;
    let agentUsage:
      | {
          promptTokens: number;
          completionTokens: number;
          cachedPromptTokens: number;
          iterations: number;
        }
      | undefined;
    // Slice 2.5-s4 — read moment state BEFORE the agent runs so the system
    // prompt can carry current_moment + required_set_status. Null = no row
    // yet (pre_start). Captured outside the try so the post-turn upsert can
    // diff against it.
    let preTurnMomentState: MomentState | null = null;
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
    this.logger.info(
      {
        module: 'onboarding',
        action: 'onboarding.tool_loop_check',
        household_id: input.householdId,
        tool_loop_available: this.toolLoopAvailable,
        agent_tools_enabled: this.agentToolsEnabled,
        has_children_service: this.childrenService !== undefined,
        has_cultural_prior_repo: this.culturalPriorRepository !== undefined,
        has_households_service: this.householdsService !== undefined,
        has_kitchen_map: this.kitchenMapService !== undefined,
        has_vocabulary: this.vocabularyService !== undefined,
        has_memory_service: this.memoryService !== undefined,
        has_child_allergens_repo: this.childAllergensRepository !== undefined,
        has_dietary_prefs_repo: this.dietaryPreferencesRepository !== undefined,
        has_food_prefs_repo: this.foodPreferencesRepository !== undefined,
        has_household_rules_repo: this.householdRulesRepository !== undefined,
        has_recipes_repo: this.recipesRepository !== undefined,
      },
      'onboarding tool loop check',
    );
    let householdDisplayName: string | null = null;
    try {
      if (
        this.toolLoopAvailable &&
        this.childrenService !== undefined &&
        this.culturalPriorRepository !== undefined &&
        this.householdsService !== undefined &&
        this.kitchenMapService !== undefined &&
        this.vocabularyService !== undefined &&
        this.memoryService !== undefined &&
        this.childAllergensRepository !== undefined &&
        this.householdAllergensRepository !== undefined &&
        this.dietaryPreferencesRepository !== undefined &&
        this.foodPreferencesRepository !== undefined &&
        this.householdRulesRepository !== undefined &&
        this.recipesRepository !== undefined
      ) {
        const map = await this.kitchenMapService.get(input.householdId);
        householdDisplayName = map.household.display_name ?? null;
        const toolSpecs = createOnboardingToolSpecs(
          { householdId: input.householdId, userId: input.userId, logger: this.logger },
          {
            childrenService: this.childrenService,
            culturalPriorRepository: this.culturalPriorRepository,
            householdsService: this.householdsService,
            memoryService: this.memoryService,
            vocabularyService: this.vocabularyService,
            childAllergensRepository: this.childAllergensRepository,
            householdAllergensRepository: this.householdAllergensRepository,
            dietaryPreferencesRepository: this.dietaryPreferencesRepository,
            foodPreferencesRepository: this.foodPreferencesRepository,
            householdRulesRepository: this.householdRulesRepository,
            recipesRepository: this.recipesRepository,
          },
        );
        const reply = await this.agent.respond(agentInput, {
          modality: TEXT_MODALITY,
          tools: toolSpecs,
          kitchenMapBlock: renderKitchenMapBlock(map),
          momentStateBlock: renderMomentStateBlock(preTurnMomentState),
          vocabularyBlock: renderVocabularyBlock(this.vocabularyService),
        });
        lumiText = reply.text;
        toolCallsSummary = reply.toolCallsSummary;
        agentUsage = reply.usage;
      } else {
        const reply = await this.agent.respond(agentInput, { modality: TEXT_MODALITY });
        lumiText = reply.text;
        agentUsage = reply.usage;
      }
    } catch (err) {
      this.logger.error(
        {
          err,
          module: 'onboarding',
          action: 'onboarding.agent_failed',
          household_id: input.householdId,
          thread_id: thread.id,
        },
        'OnboardingAgent.respond failed during text turn',
      );
      throw new UpstreamError('Onboarding agent unavailable');
    }

    // Slice B — surface agent token usage + prompt-cache effectiveness.
    // Logged unconditionally because the legacy single-shot path benefits
    // from cache visibility too. The cached_prompt_tokens figure tells us
    // whether the kitchen-map block + vocabulary block (the long stable
    // prefix) are actually being served from cache after the first turn.
    if (agentUsage !== undefined) {
      this.logger.info(
        {
          module: 'onboarding',
          action: 'onboarding.text_turn_usage',
          household_id: input.householdId,
          thread_id: thread.id,
          prompt_tokens: agentUsage.promptTokens,
          completion_tokens: agentUsage.completionTokens,
          cached_prompt_tokens: agentUsage.cachedPromptTokens,
          iterations: agentUsage.iterations,
          cache_hit_ratio:
            agentUsage.promptTokens > 0
              ? Number((agentUsage.cachedPromptTokens / agentUsage.promptTokens).toFixed(3))
              : 0,
        },
        'onboarding agent token usage',
      );
    }

    if (toolCallsSummary !== undefined && toolCallsSummary.length > 0) {
      this.logger.info(
        {
          module: 'onboarding',
          action: 'onboarding.text_turn_tools',
          household_id: input.householdId,
          thread_id: thread.id,
          tool_count: toolCallsSummary.length,
          tools_used: toolCallsSummary.map((t) => t.tool),
          tool_errors: toolCallsSummary.filter((t) => t.error).length,
        },
        'onboarding agent used tools during turn',
      );
    }

    // Slice 2.5-s4 — strip ALL [NEXT_MOMENT:<key>] directives BEFORE the
    // expression-tag sanitiser runs. Last occurrence wins for the advance key
    // (handles duplicate directives and epilogue-prose-after-directive cases).
    const allDirectiveMatches = [...lumiText.matchAll(/\[NEXT_MOMENT:([a-z0-9_]+)\]/g)];
    const advanceToMoment =
      allDirectiveMatches.length > 0
        ? (allDirectiveMatches[allDirectiveMatches.length - 1]?.[1] ?? null)
        : null;
    // Detect [CHIP_PROMPT:household_name] before stripping — M1 household name
    // hint swap. Uses includes() to avoid /g lastIndex statefulness.
    const householdNameChipRequested = lumiText.includes('[CHIP_PROMPT:household_name]');

    // Slice 2.5-s7 — extract optional elevation prompt before stripping; the
    // returned `cleaned` text has neither directive remaining. Order with
    // NEXT_MOMENT_STRIP_RE does not matter — both regexes are independent.
    const elevation = extractElevationPrompt(lumiText);
    const lumiTextWithoutDirective = elevation.cleaned
      .replace(NEXT_MOMENT_STRIP_RE, '')
      .replace(/\[CHIP_PROMPT:household_name\]/g, '')
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
    if (this.momentRepository !== undefined) {
      try {
        const counts = await this.momentRepository.countRequiredSetSources(
          input.householdId,
        );
        favoriteLunchCount = counts.favorite_lunch_count;
        const previousMoment: CurrentMoment =
          preTurnMomentState?.current_moment ?? 'pre_start';
        const advancedKey = parseMomentKey(advanceToMoment, previousMoment);
        // The agent's directive is authoritative for current_moment when
        // valid. When absent or invalid, current_moment is preserved
        // (pre_start → m1_table on the very first agent turn so a fresh
        // signup doesn't permanently stick at pre_start).
        if (advancedKey !== null) {
          nextCurrentMoment = advancedKey;
        } else if (previousMoment === 'pre_start') {
          nextCurrentMoment = 'm1_table';
        } else {
          nextCurrentMoment = previousMoment;
        }
        // DO NOT advance past summary in this slice — finalized is the
        // finalize endpoint's responsibility (2.5-s10).
        if (nextCurrentMoment === 'finalized') {
          nextCurrentMoment = 'summary';
        }

        // Kitchen-map inference: when there is no prior moment state row
        // (fresh session, reset, or row missing) and the agent didn't emit a
        // directive, the pre_start → m1_table fallback fires regardless of
        // what data already exists. This strands a reset session at M1 hint
        // chips while the agent (seeing a populated kitchen map) asks M4
        // questions. Re-anchor to the correct moment using the DB counts.
        //
        // The "no known allergens" path writes no child_allergens row, so a
        // zero count is ambiguous (may mean "not yet answered" or "all clear").
        // We only skip past M2 when allergen rows are present.
        if (
          preTurnMomentState === null &&
          advancedKey === null &&
          nextCurrentMoment === 'm1_table'
        ) {
          const m1Done = counts.household_name_set && counts.child_count > 0;
          const m2Done = counts.child_allergen_count > 0;
          if (m1Done && m2Done) {
            nextCurrentMoment = 'm4_bag'; // M3 is optional; jump straight to M4
          } else if (m1Done) {
            nextCurrentMoment = 'm2_safe';
          }
          // M1 not done → stay at m1_table
        }

        // M3 safety net: advance to m4_bag when the parent has already
        // answered M3 but the agent forgot [NEXT_MOMENT:m4_bag]. Two cases:
        //
        // A) Current turn: chips are all valid M3 cuisine/dietary keys (or
        //    the skip sentinel) — the parent just answered M3 this turn.
        // B) Prior turn: an earlier message in the thread contained M3 chip
        //    selections — the parent already answered M3 and the agent
        //    kept the moment at m3_taste across multiple turns (e.g. when
        //    the user sent "try again" after the first submission).
        //
        // M3 is optional — any chip selection is a complete answer; the LLM
        // sometimes bridges to M4 in prose but forgets the directive.
        if (nextCurrentMoment === 'm3_taste' && advancedKey === null) {
          const submittedChips = parseChipKeys(userMessage);
          const currentTurnHasM3Chips =
            submittedChips.length > 0 &&
            submittedChips.every((k) => M3_CHIP_KEYS.has(k) || k === 'skip');

          const priorTurnHasM3Chips =
            !currentTurnHasM3Chips &&
            existingTurns.some(
              (t) =>
                t.role === 'user' &&
                t.body.type === 'message' &&
                parseChipKeys(t.body.content).some((k) => M3_CHIP_KEYS.has(k)),
            );

          if (currentTurnHasM3Chips || priorTurnHasM3Chips) {
            nextCurrentMoment = 'm4_bag';
          }
        }

        // M4 safety net: advance to m5_starting_line when the parent has submitted
        // a valid bag-composition chip but the agent forgot [NEXT_MOMENT:m5_starting_line].
        // Same two-case logic as the M3 safety net.
        if (nextCurrentMoment === 'm4_bag' && advancedKey === null) {
          const submittedChips = parseChipKeys(userMessage);
          const currentTurnHasM4Chips =
            submittedChips.length > 0 &&
            submittedChips.every((k) => M4_BAG_CHIP_KEYS.has(k));

          const priorTurnHasM4Chips =
            !currentTurnHasM4Chips &&
            existingTurns.some(
              (t) =>
                t.role === 'user' &&
                t.body.type === 'message' &&
                parseChipKeys(t.body.content).some((k) => M4_BAG_CHIP_KEYS.has(k)),
            );

          if (currentTurnHasM4Chips || priorTurnHasM4Chips) {
            nextCurrentMoment = 'm5_starting_line';
          }
        }

        const advancedOutOfM2 =
          nextCurrentMoment !== 'm2_safe' &&
          previousMoment === 'm2_safe';
        const m2_allergen_response =
          counts.child_allergen_count > 0 ||
          preTurnMomentState?.required_set_status.m2_allergen_response === true ||
          advancedOutOfM2;

        // Slice 2.6-s6 — run the catalog projection BEFORE we compute
        // m5_complete + override-fewer thresholds and BEFORE upsertState,
        // so a fresh cold-start trigger this turn flows into the persisted
        // flag and into the relaxed (3 vs 10) m5_complete threshold.
        // Result cached in m5ProjectionResult and reused when chip_config
        // is assembled outside this block.
        //
        // Cold-start re-check: if a previous turn triggered cold-start but
        // Stage 1 has since completed, attempt the projection again. We skip
        // only when Stage 1 is still not done — the quick isStage1Complete()
        // check avoids the full 5s poll overhead on every repeated turn.
        const skipDueToColdStart =
          coldStartTriggered &&
          !(await this.catalogProjection?.isStage1Complete(input.householdId));
        if (
          nextCurrentMoment === 'm5_starting_line' &&
          this.catalogProjection !== undefined &&
          !skipDueToColdStart
        ) {
          let declaredCuisineTags: string[] = [];
          if (this.culturalPriorRepository !== undefined) {
            try {
              const priors = await this.culturalPriorRepository.findByHousehold(
                input.householdId,
              );
              declaredCuisineTags = priors.map((p) => p.key);
            } catch (err) {
              this.logger.warn(
                {
                  err,
                  module: 'onboarding',
                  action: 'catalog.m5.cuisine_tag_read_failed',
                  household_id: input.householdId,
                },
                'cuisine tag read failed — per-cuisine floor check skipped',
              );
            }
          }

          let allergenFilter: string[] = [];
          if (this.householdAllergensRepository !== undefined) {
            try {
              const allergenRows = await this.householdAllergensRepository.findByHouseholdId(
                input.householdId,
              );
              allergenFilter = allergenRows.map((r) => r.allergen);
            } catch (err) {
              this.logger.warn(
                { err, module: 'onboarding', action: 'catalog.m5.allergen_read_failed', household_id: input.householdId },
                'm5 allergen read failed — allergen filter skipped',
              );
            }
          }

          let requiredDietaryFlags: string[] = [];
          if (this.dietaryPreferencesRepository !== undefined) {
            try {
              const dietaryRows = await this.dietaryPreferencesRepository.findByHouseholdId(
                input.householdId,
              );
              requiredDietaryFlags = dietaryRows
                .filter((r) => r.enforcement === 'non_negotiable')
                .map((r) => r.tag);
            } catch (err) {
              this.logger.warn(
                { err, module: 'onboarding', action: 'catalog.m5.dietary_read_failed', household_id: input.householdId },
                'm5 dietary read failed — dietary filter skipped',
              );
            }
          }

          try {
            const { chips: personalizedChips, coldStartReason } =
              await this.catalogProjection.getM5Chips(
                input.householdId,
                declaredCuisineTags,
                allergenFilter,
                requiredDietaryFlags,
              );
            m5ProjectionResult = {
              chips: personalizedChips,
              coldStartReason,
            };
            if (coldStartReason !== null) {
              coldStartTriggeredThisTurn = true;
              coldStartTriggered = true;
              coldStartTriggerReason = coldStartReason;
            }
          } catch (err) {
            this.logger.warn(
              {
                err,
                module: 'onboarding',
                action: 'catalog.m5.projection_failed',
                household_id: input.householdId,
              },
              'm5 personalized chips fetch failed — chip_config left as null',
            );
            m5ProjectionFailed = true;
          }
        }

        // Slice 2.5-s10 — override path: parent explicitly advanced out of
        // m5_starting_line with 4+ items (tapped override_fewer chip). Treat
        // as complete even if count < 10.
        //
        // Slice 2.6-s6 — in cold-start mode the override floor relaxes to 1
        // (a household with even one declared dish is enough to seed Lumi
        // when no other chip path is available).
        const m5OverrideFloor = coldStartTriggered ? 1 : 4;
        const m5OverridePath =
          previousMoment === 'm5_starting_line' &&
          nextCurrentMoment !== 'm5_starting_line' &&
          counts.favorite_lunch_count >= m5OverrideFloor;

        // Slice 2.5-s10 — sticky: once m5_complete is true (natural 10-item
        // path OR override), preserve across subsequent turns in
        // summary/finalized so the gate stays open.
        //
        // Slice 2.6-s6 — cold-start mode relaxes the natural threshold from
        // 10 to 3 declared items. The override path remains parallel and
        // also gates m5_complete; sticky behavior is unchanged.
        const m5NaturalThreshold = coldStartTriggered ? 3 : 10;
        const m5_complete =
          counts.favorite_lunch_count >= m5NaturalThreshold ||
          m5OverridePath ||
          preTurnMomentState?.required_set_status.m5_complete === true;

        const requiredSetStatus: RequiredSetStatus = {
          m1_household_name: counts.household_name_set,
          m1_child_declared: counts.child_count > 0,
          m2_allergen_response,
          m5_favorite_count: counts.favorite_lunch_count,
          m5_complete,
        };

        await this.momentRepository.upsertState(input.householdId, {
          current_moment: nextCurrentMoment,
          required_set_status: requiredSetStatus,
          cold_start_triggered: coldStartTriggered,
          cold_start_trigger_reason: coldStartTriggerReason,
        });

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

        // Slice 2.6-s3 — Stage 1 trigger: parent just advanced OUT of m2_safe.
        // Fire-and-forget BullMQ enqueue — do NOT await. queue.add is
        // synchronous from the JS event loop's perspective; wrap in try/catch
        // so a queue.add error logs and lets the onboarding turn proceed
        // (M2 advance is the user-visible signal; Stage 1 is best-effort and
        // its absence falls through to the cold-start fallback in 2.6-s4).
        if (advancedOutOfM2 && this.catalogSeedQueue !== undefined) {
          try {
            this.catalogSeedQueue
              .add(
                'seed-catalog',
                { household_id: input.householdId, request_id: randomUUID() },
                CATALOG_SEED_JOB_OPTS,
              )
              .catch((err: unknown) => {
                this.logger.error(
                  {
                    module: 'onboarding',
                    action: 'stage1.enqueue_failed',
                    household_id: input.householdId,
                    err,
                  },
                  'Stage 1 catalog seed job enqueue failed (async) — M2 completion not blocked',
                );
              });
          } catch (err) {
            this.logger.error(
              {
                module: 'onboarding',
                action: 'stage1.enqueue_failed',
                household_id: input.householdId,
                err,
              },
              'Stage 1 catalog seed job enqueue failed — M2 completion not blocked',
            );
          }
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
            directive_present: advanceToMoment !== null,
            directive_valid: advancedKey !== null,
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

    let chip_config: ChipConfig | null = momentToChipConfig(nextCurrentMoment);

    // Slice 2.6-s4 — assemble chip_config from the catalog projection run
    // earlier in the moment block. The projection result was cached so we
    // don't double-call the catalog read.
    //
    // Slice 2.6-s6 — when m5ProjectionResult.coldStartReason is set, render
    // no chip card. When the projection failed (m5ProjectionFailed=true)
    // chip_config falls through to momentToChipConfig (null for M5 after
    // 2.6-s4) and the parent still sees the prose — degraded state.
    if (
      nextCurrentMoment === 'm5_starting_line' &&
      m5ProjectionResult !== null
    ) {
      if (m5ProjectionResult.coldStartReason !== null || m5ProjectionResult.chips.length === 0) {
        chip_config = null;
      } else {
        chip_config = {
          mode: 'choice',
          options: m5ProjectionResult.chips,
        };
      }
    }
    // m5ProjectionFailed branch is a silent no-op: chip_config stays at
    // whatever momentToChipConfig returned (null for M5). Logged inside
    // the moment block above.
    void m5ProjectionFailed;

    // M1 household-name chip swap: Lumi asked "what should I call your household?"
    // and emitted [CHIP_PROMPT:household_name] — replace the child/age hints with
    // household-name format examples.
    if (householdNameChipRequested) {
      chip_config = HOUSEHOLD_NAME_HINT_CHIPS;
    }

    // Slice 2.5-s7 — when the agent emitted an elevation prompt, override the
    // default chip_config with the 3-option action chip set (no skip — the
    // parent must pick one; the soft path is 'just-context'). tag_label is
    // already echoed by the agent in the prose; here we only ship the keys.
    if (elevation.prompt !== null) {
      chip_config = {
        mode: 'action',
        options: [
          { key: 'always-respect', label: 'Always respect' },
          { key: 'prefer', label: 'Prefer when possible' },
          { key: 'just-context', label: 'Just for context' },
        ],
      };
    }

    // Slice 2.5-s9 — M5 override chip is injected dynamically (not in the
    // static momentToChipConfig list) so it only appears after the parent has
    // committed to at least 4 favorites — matching the Moment5Page.tsx mock
    // threshold. The agent treats 'override_fewer' as a control key (no
    // favorite_lunch.add fired) and embeds [NEXT_MOMENT:summary].
    //
    // Slice 2.6-s6 — in cold-start mode the override threshold drops to 1.
    // chip_config is always null in cold-start (no chip card), so the
    // injection block no-ops — the override chip is not shown alongside the
    // conversational prompt. The relaxed threshold here is for future-proofing
    // if cold-start ever rides a non-null chip_config code path.
    const overrideThreshold = coldStartTriggered ? 1 : 4;
    if (
      nextCurrentMoment === 'm5_starting_line' &&
      favoriteLunchCount >= overrideThreshold &&
      chip_config !== null &&
      chip_config.mode === 'choice' &&
      chip_config.options !== undefined
    ) {
      chip_config = {
        ...chip_config,
        options: [
          ...chip_config.options,
          { key: 'override_fewer', label: 'Start with fewer' },
        ],
      };
    }

    // 7. F10 / R2-P9 — only spend an OpenAI roundtrip on the summary classifier
    //    once the conversation has plausibly reached the summary turn (3
    //    question-answer pairs = 6 LLM messages, counting the synthetic
    //    greeting as turn 0).
    const updatedHistory: LlmMessage[] = [
      ...agentInput,
      { role: 'assistant', content: sanitizedLumiText },
    ];
    let isComplete = false;
    if (updatedHistory.length >= MIN_TURNS_FOR_COMPLETION_CHECK) {
      try {
        isComplete = await this.agent.isSummaryConfirmed(updatedHistory);
      } catch (err) {
        // Best-effort — failure here just leaves is_complete=false and the
        // client keeps the conversation going.
        this.logger.warn(
          {
            err,
            module: 'onboarding',
            action: 'onboarding.is_complete_check_failed',
            thread_id: thread.id,
          },
          'isSummaryConfirmed classification failed — defaulting to false',
        );
      }
    }

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
          chipConfig = momentToChipConfig(validMoment);
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

// ---------------------------------------------------------------------------
// Slice C — system-prompt block renderers
// ---------------------------------------------------------------------------
// The agent's tool-loop path injects two blocks into the system prompt:
//   - kitchenMapBlock: the household's current projection (what's been
//     captured so far). Agent uses this to avoid re-asking known facts
//     and to probe for gaps.
//   - vocabularyBlock: the active tag vocabulary (allergens, dietary,
//     cultural, cuisine). Agent uses this to emit valid tag values.
//
// Both are placed at the top of the system prompt so OpenAI's auto-prefix
// caching can pick them up. They change only when the underlying data
// changes (kitchen_map_version bump / *_tags table write); within a single
// household conversation the cache stays warm.
// ---------------------------------------------------------------------------

function renderKitchenMapBlock(map: KitchenMap): string {
  // Trim noisy fields (created_at, etc.) before serialising — the agent
  // only needs current state, not row metadata.
  //
  // Slice 2-s27 — household-level food identity (cultural / dietary /
  // household-wide allergens) is projected at the top level.
  // Slice 2.5-s4 — extended with the new top-level structured signal
  // arrays from 2.5-s1 (allergens, dietary, food_preferences,
  // favorite_lunches, rules) plus household.display_name,
  // child.bag_composition_pattern, and meta.required_set_complete.
  const trimmed = {
    household: {
      display_name: map.household.display_name,
      tier: map.household.tier,
      timezone: map.household.timezone,
      cultural_identifiers: map.household.cultural_identifiers,
      dietary_preferences: map.household.dietary_preferences,
      declared_allergens: map.household.declared_allergens,
    },
    caregivers: map.caregivers.map((c) => ({
      role: c.role,
      display_name: c.display_name,
      cultural_language: c.cultural_language,
    })),
    children: map.children.map((c) => ({
      id: c.id,
      name: c.name,
      age_band: c.age_band,
      bag_composition_pattern: c.bag_composition_pattern,
      declared_allergens: c.declared_allergens,
      cultural_identifiers: c.cultural_identifiers,
      dietary_preferences: c.dietary_preferences,
      school_policies: c.school_policies,
    })),
    cultural: {
      active: map.cultural.active.map((p) => p.key),
      suggested: map.cultural.suggested.map((p) => p.key),
    },
    memory_notes: map.memory.nodes.map((n) => ({
      type: n.node_type,
      facet: n.facet,
      text: n.prose_text,
      child_id: n.subject_child_id,
    })),
    allergens: map.allergens.map((a) => ({
      child_id: a.child_id,
      allergen: a.allergen,
      source: a.source,
    })),
    dietary: map.dietary.map((d) => ({
      child_id: d.child_id,
      tag: d.tag,
      enforcement: d.enforcement,
    })),
    food_preferences: map.food_preferences.map((fp) => ({
      child_id: fp.child_id,
      item: fp.item,
      valence: fp.valence,
      enforcement: fp.enforcement,
    })),
    favorite_lunches: map.favorite_lunches.map((fl) => ({
      item: fl.item,
      position: fl.position,
    })),
    rules: map.rules.map((r) => ({
      rule_type: r.rule_type,
      custom_label: r.custom_label,
      enforcement: r.enforcement,
    })),
    meta: {
      is_complete: map.meta.is_complete,
      required_set_complete: map.meta.required_set_complete,
    },
  };
  return '```json\n' + JSON.stringify(trimmed, null, 2) + '\n```';
}

// Slice 2.5-s4 — render the moment-state block injected into the system
// prompt on every text-mode turn. Small (~15 lines); the agent reads
// current_moment + required_set_status to decide which moment to work
// within and whether the finalize gate is satisfied.
//
// Slice 2.6-s6 — when cold_start_triggered is true, surface the flag (and
// its reason) so the agent emits the cold-start M5 prompt instead of
// describing the chip card. The reason line is only rendered when the
// flag is true so the legacy chip-path prompt cache stays warm.
export function renderMomentStateBlock(state: MomentState | null): string {
  if (state === null) {
    return `CURRENT ONBOARDING STATE
current_moment: pre_start
required_set:
  m1_household_name: false
  m1_child_declared: false
  m2_allergen_response: false
  m5_favorite_count: 0
  m5_complete: false
required_set_complete: false
cold_start_triggered: false`;
  }
  const rss = state.required_set_status;
  const complete =
    rss.m1_household_name &&
    rss.m1_child_declared &&
    rss.m2_allergen_response &&
    rss.m5_complete;
  const coldStartReasonLine = state.cold_start_triggered
    ? `\ncold_start_trigger_reason: ${state.cold_start_trigger_reason ?? 'unknown'}`
    : '';
  return `CURRENT ONBOARDING STATE
current_moment: ${state.current_moment}
required_set:
  m1_household_name: ${rss.m1_household_name}
  m1_child_declared: ${rss.m1_child_declared}
  m2_allergen_response: ${rss.m2_allergen_response}
  m5_favorite_count: ${rss.m5_favorite_count}
  m5_complete: ${rss.m5_complete}
required_set_complete: ${complete}
cold_start_triggered: ${state.cold_start_triggered}${coldStartReasonLine}`;
}

function renderVocabularyBlock(vocab: VocabularyService): string {
  const snap = vocab.snapshot();
  const lines: string[] = [];

  lines.push('Allergens (use as declared_allergens values):');
  for (const a of snap.allergen_tags.filter((t) => t.is_active)) {
    const aliases = a.alias_keys.length > 0 ? ` (aliases: ${a.alias_keys.join(', ')})` : '';
    lines.push(`  ${a.key}${aliases}`);
  }

  lines.push('\nDietary tags (use as dietary_preferences values):');
  for (const d of snap.dietary_tags.filter((t) => t.is_active)) {
    const implies = d.implies.length > 0 ? ` (implies: ${d.implies.join(', ')})` : '';
    lines.push(`  ${d.key}${implies}`);
  }

  lines.push('\nCultural tags (use as cultural_identifiers values or cultural.note keys):');
  for (const c of snap.cultural_tags.filter((t) => t.is_active)) {
    const template = c.is_template ? ' [template]' : '';
    lines.push(`  ${c.key}${template}`);
  }

  return lines.join('\n');
}
