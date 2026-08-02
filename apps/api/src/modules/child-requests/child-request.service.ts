import type { FastifyBaseLogger } from 'fastify';
import type { PendingChildRequestsResponse } from '@hivekitchen/types';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import type { FoodPreferencesRepository } from '../food-preferences/food-preferences.repository.js';
import type { SignalsService } from '../signals/signals.service.js';
import type { ThreadRepository } from '../threads/thread.repository.js';
import type { ChildRequestRepository } from './child-request.repository.js';

// Slice 4-S15 — Child Request-a-Lunch + Parent Approval.
//
// SSE note: the slice doc calls for dispatching child_request.received /
// child_request.resolved to the household. The contract event types + web
// handler land in this slice, but the server-side SSE fan-out does not exist
// yet (the /v1/events channel is a heartbeat-only stub; real Redis pub/sub
// fan-out is Story 5.2). There is therefore no dispatcher to call here — the
// emit becomes live once 5.2 ships. The parent's pending-requests view loads on
// mount and updates optimistically on approve/decline, so the flow is fully
// functional without the push.

const UNIQUE_VIOLATION_CODE = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION_CODE
  );
}

// Planner signal write happens only on approval — softest enforcement level so
// the request biases but never gates plan generation.
const FOOD_PREFERENCE_ITEM_MAX = 100;

export class ChildRequestService {
  // signalsService (Story 15-s2) is optional so existing constructions keep
  // working; record() never throws, so no seam needs its own try/catch.
  constructor(
    private readonly repo: ChildRequestRepository,
    private readonly foodPreferencesRepo: FoodPreferencesRepository,
    private readonly threadRepo: ThreadRepository,
    private readonly logger: FastifyBaseLogger,
    private readonly signalsService?: Pick<SignalsService, 'record'>,
  ) {}

  async submitRequest(
    sessionVerification: { childId: string; householdId: string; sessionId: string },
    requestText: string,
  ): Promise<{ id: string }> {
    let row;
    try {
      row = await this.repo.create({
        householdId: sessionVerification.householdId,
        childId: sessionVerification.childId,
        sessionId: sessionVerification.sessionId,
        requestText,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('A request already exists for this lunch link');
      }
      throw err;
    }

    // Story 15-s2 — the immutable record of what the child asked for. The
    // mutable workflow object is the child_lunch_requests row above; the signal
    // is the append-only fact (spec §4.9). Text is encrypted by SignalsService.
    await this.signalsService?.record({
      household_id: sessionVerification.householdId,
      child_id: sessionVerification.childId,
      subject_ref: { request_id: row.id, session_id: sessionVerification.sessionId },
      payload: { kind: 'lunch_request', text: requestText },
      occurred_at: new Date().toISOString(),
      source: 'lunch_link',
    });

    // Best-effort visibility in the parent's Lumi planning thread. Never blocks
    // or fails the submission.
    await this.injectPlanningThreadTurn(
      sessionVerification.householdId,
      sessionVerification.childId,
      requestText,
    );

    return { id: row.id };
  }

  async getPendingRequests(householdId: string): Promise<PendingChildRequestsResponse> {
    const rows = await this.repo.findPendingByHousehold(householdId);
    return {
      requests: rows.map((r) => ({
        id: r.id,
        child_id: r.child_id,
        child_name: r.child_name,
        request_text: r.request_text,
        status: r.status as 'pending' | 'approved' | 'declined',
        created_at: r.created_at,
      })),
    };
  }

  async approve(
    id: string,
    { resolvedByUserId, householdId }: { resolvedByUserId: string; householdId: string },
  ): Promise<void> {
    const request = await this.repo.findById(id, householdId);
    if (request === null) throw new NotFoundError('Request not found');
    if (request.status !== 'pending') throw new ConflictError('Request already resolved');

    // P2 patch: catch NotFoundError from resolve() (0-row concurrent update) and
    // rethrow as ConflictError so the caller gets 409, not 404.
    try {
      await this.repo.resolve(id, { status: 'approved', resolvedByUserId });
    } catch (err) {
      if (err instanceof NotFoundError) throw new ConflictError('Request already resolved');
      throw err;
    }

    // P1 patch: best-effort — if the food_preferences write fails the approval
    // is already committed, so log at warn and continue rather than surfacing a
    // 500. Mirrors the thread-turn injection pattern above.
    try {
      await this.foodPreferencesRepo.declare(
        householdId,
        request.child_id,
        request.request_text.slice(0, FOOD_PREFERENCE_ITEM_MAX),
        'likes',
        'just_for_context',
        'child_request',
      );
    } catch (err) {
      this.logger.warn({ err, householdId }, 'child-request: food-preferences mirror failed');
    }

    // Story 15-s2 — approval mirrors into food_preferences, so the same edit
    // is dual-written as a preference_edit signal. OUTSIDE the try: the signal
    // records that the parent approved the request — an event, not a store
    // update — so a failed mirror must not lose it (log ⊇ stores; doctrine
    // resolved in the 15-s2 code review). Item is encrypted by SignalsService
    // (food_preferences.item is encrypted at rest too).
    await this.signalsService?.record({
      household_id: householdId,
      child_id: request.child_id,
      subject_ref: null,
      payload: {
        kind: 'preference_edit',
        item: request.request_text.slice(0, FOOD_PREFERENCE_ITEM_MAX),
        valence: 'likes',
        enforcement: 'just_for_context',
        scope: 'child',
      },
      occurred_at: new Date().toISOString(),
      source: 'app',
    });
  }

  async decline(
    id: string,
    { resolvedByUserId, householdId }: { resolvedByUserId: string; householdId: string },
  ): Promise<void> {
    const request = await this.repo.findById(id, householdId);
    if (request === null) throw new NotFoundError('Request not found');
    if (request.status !== 'pending') throw new ConflictError('Request already resolved');

    // P2 patch: same as approve() — catch concurrent-resolve NotFoundError and
    // rethrow as ConflictError for a correct 409 response.
    try {
      await this.repo.resolve(id, { status: 'declined', resolvedByUserId });
    } catch (err) {
      if (err instanceof NotFoundError) throw new ConflictError('Request already resolved');
      throw err;
    }
  }

  // Reuses ThreadRepository.appendTurnNext (which already handles per-thread
  // server_seq allocation + unique-violation retry) rather than adding a
  // divergent LumiRepository.insertTurn that would re-implement the same logic.
  // The real thread_turns schema carries a structured TurnBody (no metadata
  // column) and role ∈ {user,lumi,system} — so this writes a plain 'lumi'
  // message turn; the actionable surface is <PendingChildRequests>, not the
  // turn. No SSE thread.turn is fired (no dispatcher yet — see header note).
  private async injectPlanningThreadTurn(
    householdId: string,
    childId: string,
    requestText: string,
  ): Promise<void> {
    try {
      const thread = await this.threadRepo.findActiveThreadByHousehold(
        householdId,
        'planning',
        'text',
      );
      if (thread === null) {
        this.logger.warn(
          { householdId },
          'child-request: no active planning thread; skipping Lumi turn',
        );
        return;
      }
      const childName = (await this.repo.findChildName(childId, householdId)) ?? 'Your child';
      await this.threadRepo.appendTurnNext({
        threadId: thread.id,
        role: 'lumi',
        body: { type: 'message', content: `${childName} asked: "${requestText}"` },
        modality: 'text',
      });
    } catch (err) {
      this.logger.warn(
        { err, householdId },
        'child-request: planning thread injection failed',
      );
    }
  }
}
