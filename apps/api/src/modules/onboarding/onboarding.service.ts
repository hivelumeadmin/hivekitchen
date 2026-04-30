import type { FastifyBaseLogger } from 'fastify';
import { OPENING_GREETING } from '@hivekitchen/contracts';
import { ConflictError, UpstreamError } from '../../common/errors.js';
import { stripExpressionTags } from '../../common/strip-expression-tags.js';
import type { OnboardingAgent, LlmMessage } from '../../agents/onboarding.agent.js';
import type { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';
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
}

export interface FinalizeTextOnboardingResult {
  thread_id: string;
  summary: {
    cultural_templates: string[];
    palate_notes: string[];
    allergens_mentioned: string[];
  };
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

  constructor(deps: OnboardingServiceDeps) {
    this.threads = deps.threads;
    this.agent = deps.agent;
    this.culturalPriorService = deps.culturalPriorService;
    this.logger = deps.logger;
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
    let lumiText: string;
    try {
      const reply = await this.agent.respond(agentInput, { modality: TEXT_MODALITY });
      lumiText = reply.text;
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
      };
      const summary = {
        cultural_templates: onlyStrings(payload.cultural_templates),
        palate_notes: onlyStrings(payload.palate_notes),
        allergens_mentioned: onlyStrings(payload.allergens_mentioned),
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
    try {
      await this.threads.appendTurnNext({
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

    // 6. Close the thread.
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
