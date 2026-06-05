import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';
import type { ChildrenRepository } from './children.repository.js';
import type { MemoryRepository } from '../memory/memory.repository.js';
import type { ChildPreferencesRepository } from '../child-preferences/child-preferences.repository.js';

const COOLDOWN_MS = 365 * 24 * 60 * 60 * 1000;

export interface FlavorJourneyResetDeps {
  childrenRepository: ChildrenRepository;
  memoryRepository: MemoryRepository;
  childPreferencesRepository: ChildPreferencesRepository;
  logger: FastifyBaseLogger;
  audit?: AuditService;
}

export type FlavorJourneyResetOutcome =
  | { type: 'not_found' }
  | { type: 'cooldown_active'; last_reset_at: string }
  | { type: 'ok'; child_id: string; reset_at: string };

export class FlavorJourneyResetService {
  constructor(private readonly deps: FlavorJourneyResetDeps) {}

  async reset(
    childId: string,
    householdId: string,
    userId: string,
    requestId: string,
  ): Promise<FlavorJourneyResetOutcome> {
    // Verify child ownership. 404 guard: returns null when child is absent
    // or belongs to a different household (no existence oracle).
    const child = await this.deps.childrenRepository.findById(householdId, childId);
    if (child === null) return { type: 'not_found' };

    // 365-day cooldown check.
    const lastResetAt = await this.deps.childrenRepository.getFlavorJourneyResetAt(
      childId,
      householdId,
    );
    if (lastResetAt !== null) {
      const elapsedMs = Date.now() - new Date(lastResetAt).getTime();
      if (elapsedMs < COOLDOWN_MS) {
        return { type: 'cooldown_active', last_reset_at: lastResetAt };
      }
    }

    const resetAt = new Date().toISOString();

    // Cascade 1: soft-forget all child-associated memory nodes.
    // The nightly memory-forget.job.ts (7-S5) will hard-delete them after 30 days.
    await this.deps.memoryRepository.softForgetChildNodes(childId, householdId, resetAt);

    // Cascade 2: hard-delete all child preference signals.
    // child_preferences are ephemeral emoji-rating signals — no recovery window needed.
    await this.deps.childPreferencesRepository.deleteByChild(childId, householdId);

    // Stamp the cooldown timestamp last so a failed cascade does not activate the
    // cooldown and leave the child in a partially-reset state.
    await this.deps.childrenRepository.setFlavorJourneyResetAt(childId, householdId, resetAt);

    // Best-effort audit: a failure here must not fail the reset.
    if (this.deps.audit) {
      try {
        await this.deps.audit.write({
          event_type: 'child.flavor_journey_reset',
          household_id: householdId,
          user_id: userId,
          request_id: requestId,
          metadata: { child_id: childId },
        });
      } catch (err) {
        this.deps.logger.warn(
          { err, module: 'flavor-journey-reset', child_id: childId },
          'audit write failed for flavor journey reset — reset succeeded',
        );
      }
    }

    return { type: 'ok', child_id: childId, reset_at: resetAt };
  }
}
