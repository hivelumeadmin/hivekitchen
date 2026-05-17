import type { FastifyBaseLogger } from 'fastify';
import { OPENING_GREETING } from '@hivekitchen/contracts';
import type { KitchenMap } from '@hivekitchen/types';
import { ConflictError, UpstreamError } from '../../common/errors.js';
import { stripExpressionTags } from '../../common/strip-expression-tags.js';
import type { OnboardingAgent, LlmMessage } from '../../agents/onboarding.agent.js';
import { createOnboardingToolSpecs } from '../../agents/tools/onboarding.tools.js';
import type { ChildrenService } from '../children/children.service.js';
import type { CulturalPriorRepository } from '../cultural-priors/cultural-prior.repository.js';
import type { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';
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
      this.memoryService !== undefined
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
    const lastTurn: TurnRow | undefined = existingTurns[existingTurns.length - 1];
    const isOrphanedUserTurn =
      lastTurn !== undefined &&
      lastTurn.role === 'user' &&
      lastTurn.body.type === 'message' &&
      lastTurn.body.content === input.message;

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
        body: { type: 'message', content: input.message },
        modality: TEXT_MODALITY,
      });
      agentInput = [...history, { role: 'user', content: input.message }];
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
    try {
      if (
        this.toolLoopAvailable &&
        this.childrenService !== undefined &&
        this.culturalPriorRepository !== undefined &&
        this.householdsService !== undefined &&
        this.kitchenMapService !== undefined &&
        this.vocabularyService !== undefined &&
        this.memoryService !== undefined
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
          },
        );
        const reply = await this.agent.respond(agentInput, {
          modality: TEXT_MODALITY,
          tools: toolSpecs,
          kitchenMapBlock: renderKitchenMapBlock(map),
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

    // R2-P8 — defense-in-depth: TEXT_RULES instructs the model not to emit
    // expression tags, but rule-adherence is ~95%. Strip [warmly]/[pause]/etc.
    // before persisting and returning so a leak never surfaces literally to
    // the user.
    const sanitizedLumiText = stripExpressionTags(lumiText);

    // 6. Persist Lumi's reply.
    const lumiTurn = await this.threads.appendTurnNext({
      threadId: thread.id,
      role: 'lumi',
      body: { type: 'message', content: sanitizedLumiText },
      modality: TEXT_MODALITY,
    });

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
  // household-wide allergens) is projected at the top level, mirroring the
  // new data model. Per-child arrays remain on each child for the
  // override path (typically empty after this slice) PLUS per-child
  // medical allergens.
  const trimmed = {
    household: {
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
    is_complete: map.meta.is_complete,
  };
  return '```json\n' + JSON.stringify(trimmed, null, 2) + '\n```';
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
