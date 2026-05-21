import type { FastifyBaseLogger } from 'fastify';
import { OPENING_GREETING, type ChipConfig } from '@hivekitchen/contracts';
import type { KitchenMap } from '@hivekitchen/types';
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
import type { HouseholdRulesRepository } from '../household-rules/household-rules.repository.js';
import type { HouseholdsService } from '../households/households.service.js';
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
  // Slice 2-S26 — internal signal for the route handler's audit emission.
  // Stripped by the response Zod schema before serialization (the wire shape
  // is TextOnboardingTurnResponseSchema, which excludes this field).
  // True when the household already had ≥1 message turn on this thread
  // before this call ran — i.e., the user is mid-conversation, not on turn 1.
  _was_resumed: boolean;
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
      // Slice 2.5-s5 — M1 is a broad open question; hint chips are illustrative
      // examples (non-selectable). Copy verbatim from Moment1Page.tsx mock.
      return {
        mode: 'hint',
        hints: [
          'Khan-Patel family kitchen — two kids, Layla 10 and Adam 12',
          'Sharma kitchen — three girls aged 5, 7, and 11',
          'Just my son Aarav, 8 years old',
        ],
      };
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
          { key: 'tree-nuts', label: 'Tree nuts' },
          { key: 'dairy', label: 'Dairy' },
          { key: 'eggs', label: 'Eggs' },
          { key: 'soy', label: 'Soy' },
          { key: 'wheat', label: 'Wheat / gluten' },
          { key: 'fish', label: 'Fish' },
          { key: 'shellfish', label: 'Shellfish' },
          { key: 'sesame', label: 'Sesame' },
        ],
      };
    case 'm3_taste':
      // Slice 2.5-s7 — M3 is the densest moment: a broad open question
      // capturing cultural / religious identity, dietary, cuisine, and food
      // preferences in ONE rich free-text response. Hint chips are
      // illustrative (non-selectable); the parent free-types. M3 is OPTIONAL,
      // so the Skip chip is first-class via skip_label. Copy verbatim from
      // Moment3Page.tsx scenario 'broad-hint'.
      return {
        mode: 'hint',
        hints: [
          'Halal Punjabi household, mostly home-cooked Indian',
          'Italian heritage, kids love pasta — dairy-light for the youngest',
          'Hindu vegetarian — South Indian for me, Mexican for them',
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
      return null; // 2.5-s9 will fill this
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
      this.dietaryPreferencesRepository !== undefined &&
      this.foodPreferencesRepository !== undefined &&
      this.householdRulesRepository !== undefined
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

    const lastTurn: TurnRow | undefined = existingTurns[existingTurns.length - 1];
    const isOrphanedUserTurn =
      lastTurn !== undefined &&
      lastTurn.role === 'user' &&
      lastTurn.body.type === 'message' &&
      lastTurn.body.content === userMessage;

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
        body: { type: 'message', content: userMessage },
        modality: TEXT_MODALITY,
      });
      agentInput = [...history, { role: 'user', content: userMessage }];
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
        this.dietaryPreferencesRepository !== undefined &&
        this.foodPreferencesRepository !== undefined &&
        this.householdRulesRepository !== undefined
      ) {
        const map = await this.kitchenMapService.get(input.householdId);
        const toolSpecs = createOnboardingToolSpecs(
          { householdId: input.householdId, userId: input.userId, logger: this.logger },
          {
            childrenService: this.childrenService,
            culturalPriorRepository: this.culturalPriorRepository,
            householdsService: this.householdsService,
            memoryService: this.memoryService,
            vocabularyService: this.vocabularyService,
            childAllergensRepository: this.childAllergensRepository,
            dietaryPreferencesRepository: this.dietaryPreferencesRepository,
            foodPreferencesRepository: this.foodPreferencesRepository,
            householdRulesRepository: this.householdRulesRepository,
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
    // Slice 2.5-s7 — extract optional elevation prompt before stripping; the
    // returned `cleaned` text has neither directive remaining. Order with
    // NEXT_MOMENT_STRIP_RE does not matter — both regexes are independent.
    const elevation = extractElevationPrompt(lumiText);
    const lumiTextWithoutDirective = elevation.cleaned
      .replace(NEXT_MOMENT_STRIP_RE, '')
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
    if (this.momentRepository !== undefined) {
      try {
        const counts = await this.momentRepository.countRequiredSetSources(
          input.householdId,
        );
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

        const advancedOutOfM2 =
          nextCurrentMoment !== 'm2_safe' &&
          previousMoment === 'm2_safe';
        const m2_allergen_response =
          counts.child_allergen_count > 0 ||
          preTurnMomentState?.required_set_status.m2_allergen_response === true ||
          advancedOutOfM2;

        const requiredSetStatus: RequiredSetStatus = {
          m1_household_name: counts.household_name_set,
          m1_child_declared: counts.child_count > 0,
          m2_allergen_response,
          m5_favorite_count: counts.favorite_lunch_count,
          m5_complete: counts.favorite_lunch_count >= 10,
        };

        await this.momentRepository.upsertState(input.householdId, {
          current_moment: nextCurrentMoment,
          required_set_status: requiredSetStatus,
        });

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
            required_set_complete:
              requiredSetStatus.m1_household_name &&
              requiredSetStatus.m1_child_declared &&
              requiredSetStatus.m2_allergen_response &&
              requiredSetStatus.m5_complete,
          },
          'onboarding moment state updated',
        );
      } catch (err) {
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

    // Slice 2.5-s7 — when the agent emitted an elevation prompt, override the
    // default chip_config with the 3-option action chip set (no skip — the
    // parent must pick one; the soft path is 'just-context'). tag_label is
    // already echoed by the agent in the prose; here we only ship the keys.
    let chip_config: ChipConfig | null = momentToChipConfig(nextCurrentMoment);
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
      _was_resumed: wasResumed,
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
      return { thread_id: thread.id, summary };
    }

    // F09 — no MIN_TURNS_BEFORE_FINALIZE magic. The only structurally
    // invalid case is a thread with zero turns; everything else is the
    // classifier's call.
    if (turns.length === 0) {
      // F17 — distinguish from the classifier-says-not-ready case.
      throw new ConflictError('no turns recorded — start the conversation first');
    }

    const history = this.turnsToLlmMessages(turns);

    // F06 — propagate classifier failures as upstream errors instead of
    // silently coercing them into a "not ready" 409. Hiding an OpenAI
    // outage as a finalize-not-ready response misleads the client and
    // hides a real incident. R2-P7 — generic detail; raw err logged only.
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
required_set_complete: false`;
  }
  const rss = state.required_set_status;
  const complete =
    rss.m1_household_name &&
    rss.m1_child_declared &&
    rss.m2_allergen_response &&
    rss.m5_complete;
  return `CURRENT ONBOARDING STATE
current_moment: ${state.current_moment}
required_set:
  m1_household_name: ${rss.m1_household_name}
  m1_child_declared: ${rss.m1_child_declared}
  m2_allergen_response: ${rss.m2_allergen_response}
  m5_favorite_count: ${rss.m5_favorite_count}
  m5_complete: ${rss.m5_complete}
required_set_complete: ${complete}`;
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
