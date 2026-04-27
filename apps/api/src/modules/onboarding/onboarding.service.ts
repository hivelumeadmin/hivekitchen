import type { FastifyBaseLogger } from 'fastify';
import { ConflictError, UpstreamError } from '../../common/errors.js';
import type { OnboardingAgent, LlmMessage } from '../../agents/onboarding.agent.js';
import type { ThreadRepository, ThreadRow, TurnRow } from '../threads/thread.repository.js';

export interface OnboardingServiceDeps {
  threads: ThreadRepository;
  agent: OnboardingAgent;
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

// F10 — three signal questions × user/lumi pair = 6 turns minimum before a
// summary turn is even plausible. Below this we skip the OpenAI classifier
// call entirely (saves a per-turn round-trip in the early conversation).
const MIN_TURNS_FOR_COMPLETION_CHECK = 6;

const onlyStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export class OnboardingService {
  private readonly threads: ThreadRepository;
  private readonly agent: OnboardingAgent;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: OnboardingServiceDeps) {
    this.threads = deps.threads;
    this.agent = deps.agent;
    this.logger = deps.logger;
  }

  async submitTextTurn(input: SubmitTextTurnInput): Promise<SubmitTextTurnResult> {
    // 1. Refuse if a closed onboarding thread already carries a summary.
    if (await this.householdHasCompletedOnboarding(input.householdId)) {
      throw new ConflictError('onboarding already complete');
    }

    // 2. Reuse the active thread or create one.
    let thread: ThreadRow | null = await this.threads.findActiveThreadByHousehold(
      input.householdId,
      ONBOARDING_THREAD_TYPE,
    );
    if (thread === null) {
      thread = await this.threads.createThread(input.householdId, ONBOARDING_THREAD_TYPE);
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

    // F08 — orphaned user turn: a previous attempt persisted the user turn
    //   then failed before Lumi's reply was written (AC7 contract). On the
    //   client retry we must NOT append a duplicate user turn — instead
    //   resume the conversation by treating the existing trailing user turn
    //   as the input for this request. The client's `input.message` typically
    //   carries the same content per AC7.
    const lastTurn: TurnRow | undefined = existingTurns[existingTurns.length - 1];
    const isOrphanedUserTurn =
      lastTurn !== undefined &&
      lastTurn.role === 'user' &&
      lastTurn.body.type === 'message';

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
        modality: 'text',
      });
      agentInput = [...history, { role: 'user', content: input.message }];
    }

    // 5. Call the agent — translate any failure into UpstreamError (502).
    let lumiText: string;
    try {
      lumiText = await this.agent.respond(agentInput, { modality: 'text' });
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
      throw new UpstreamError(
        `Onboarding agent unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 6. Persist Lumi's reply.
    const lumiTurn = await this.threads.appendTurnNext({
      threadId: thread.id,
      role: 'lumi',
      body: { type: 'message', content: lumiText },
      modality: 'text',
    });

    // 7. F10 — only spend an OpenAI roundtrip on the summary classifier
    //    once the conversation has plausibly reached the summary turn.
    const updatedHistory: LlmMessage[] = [
      ...agentInput,
      { role: 'assistant', content: lumiText },
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
      lumi_response: lumiText,
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

    // 2. Need an active thread to finalise.
    const thread = await this.threads.findActiveThreadByHousehold(
      input.householdId,
      ONBOARDING_THREAD_TYPE,
    );
    if (thread === null) {
      throw new ConflictError('no active onboarding thread to finalize');
    }

    const turns = await this.threads.listTurns(thread.id);

    // F05 — idempotent: a concurrent finalize call may have already
    // appended the summary turn on this thread. Return that summary
    // (and ensure the thread is closed) instead of writing a duplicate.
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
    // hides a real incident.
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
      throw new UpstreamError(
        `Onboarding readiness check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!confirmed) {
      // F17 — distinct message from the empty-thread case.
      throw new ConflictError('summary not yet confirmed — keep talking with Lumi');
    }

    // 3. Run extraction. On failure, persist an empty summary + return 200
    //    (mirrors the Story 2.6 webhook contract — best-effort, never blocks
    //    completion).
    const transcript = turns
      .filter((t) => t.role !== 'system' && t.body.type === 'message')
      .map((t) => ({
        role: t.role === 'lumi' ? 'agent' : 'user',
        message: t.body.type === 'message' ? t.body.content : '',
      }));

    let summary: FinalizeTextOnboardingResult['summary'] = {
      cultural_templates: [],
      palate_notes: [],
      allergens_mentioned: [],
    };
    try {
      summary = await this.agent.extractSummary(transcript);
    } catch (err) {
      this.logger.warn(
        {
          err,
          module: 'onboarding',
          action: 'onboarding.summary_extraction_failed',
          thread_id: thread.id,
          household_id: input.householdId,
        },
        'onboarding summary extraction failed — persisting empty summary',
      );
    }

    // 4. Append the system_event summary turn (modality='text' — system
    //    events are not voice).
    await this.threads.appendTurnNext({
      threadId: thread.id,
      role: 'system',
      body: {
        type: 'system_event',
        event: SUMMARY_EVENT,
        payload: summary,
      },
      modality: 'text',
    });

    // 5. Close the thread.
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
  // turn on a CLOSED onboarding thread? AC9 gate. Active-thread summary
  // checks live inline at the call sites (F16) so we don't have to read
  // the active turns twice.
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
