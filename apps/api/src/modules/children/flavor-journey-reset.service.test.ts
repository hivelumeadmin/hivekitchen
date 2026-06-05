import { describe, it, expect, vi } from 'vitest';
import { FlavorJourneyResetService } from './flavor-journey-reset.service.js';

const CHILD_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';

function makeChild() {
  return { id: CHILD_ID, household_id: HOUSEHOLD_ID, name: 'Layla' } as never;
}

function makeDeps() {
  const childrenRepository = {
    findById: vi.fn().mockResolvedValue(makeChild()),
    getFlavorJourneyResetAt: vi.fn().mockResolvedValue(null),
    setFlavorJourneyResetAt: vi.fn().mockResolvedValue(undefined),
  };
  const memoryRepository = {
    softForgetChildNodes: vi.fn().mockResolvedValue(3),
  };
  const childPreferencesRepository = {
    deleteByChild: vi.fn().mockResolvedValue(5),
  };
  const audit = { write: vi.fn().mockResolvedValue(undefined) };
  const logger = { warn: vi.fn() };
  return {
    childrenRepository,
    memoryRepository,
    childPreferencesRepository,
    audit,
    logger,
  };
}

describe('FlavorJourneyResetService', () => {
  describe('not_found', () => {
    it('returns not_found when child does not exist in household', async () => {
      const deps = makeDeps();
      deps.childrenRepository.findById.mockResolvedValue(null);
      const svc = new FlavorJourneyResetService(deps as never);

      const result = await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);

      expect(result).toEqual({ type: 'not_found' });
      // No cascade runs when the child is not owned.
      expect(deps.memoryRepository.softForgetChildNodes).not.toHaveBeenCalled();
      expect(deps.childPreferencesRepository.deleteByChild).not.toHaveBeenCalled();
    });
  });

  describe('cooldown_active', () => {
    it('returns cooldown_active when last_reset_at is within 365 days', async () => {
      const deps = makeDeps();
      const recentDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      deps.childrenRepository.getFlavorJourneyResetAt.mockResolvedValue(recentDate);
      const svc = new FlavorJourneyResetService(deps as never);

      const result = await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);

      expect(result).toEqual({ type: 'cooldown_active', last_reset_at: recentDate });
      expect(deps.memoryRepository.softForgetChildNodes).not.toHaveBeenCalled();
      expect(deps.childrenRepository.setFlavorJourneyResetAt).not.toHaveBeenCalled();
    });
  });

  describe('ok', () => {
    it('proceeds when last_reset_at is null (never reset)', async () => {
      const deps = makeDeps();
      const svc = new FlavorJourneyResetService(deps as never);

      const result = await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);

      expect(result.type).toBe('ok');
      expect(deps.memoryRepository.softForgetChildNodes).toHaveBeenCalledWith(
        CHILD_ID,
        HOUSEHOLD_ID,
        expect.any(String),
      );
      expect(deps.childPreferencesRepository.deleteByChild).toHaveBeenCalledWith(
        CHILD_ID,
        HOUSEHOLD_ID,
      );
      expect(deps.childrenRepository.setFlavorJourneyResetAt).toHaveBeenCalledWith(
        CHILD_ID,
        HOUSEHOLD_ID,
        expect.any(String),
      );
    });

    it('proceeds when last_reset_at is more than 365 days ago', async () => {
      const deps = makeDeps();
      const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000 - 1000).toISOString();
      deps.childrenRepository.getFlavorJourneyResetAt.mockResolvedValue(oldDate);
      const svc = new FlavorJourneyResetService(deps as never);

      const result = await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);

      expect(result.type).toBe('ok');
    });

    it('writes audit event on success', async () => {
      const deps = makeDeps();
      const svc = new FlavorJourneyResetService(deps as never);

      await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);

      expect(deps.audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'child.flavor_journey_reset',
          household_id: HOUSEHOLD_ID,
          user_id: USER_ID,
          metadata: { child_id: CHILD_ID },
        }),
      );
    });

    it('does not throw if audit write fails (best-effort)', async () => {
      const deps = makeDeps();
      deps.audit.write.mockRejectedValue(new Error('db error'));
      const svc = new FlavorJourneyResetService(deps as never);

      await expect(
        svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID),
      ).resolves.toMatchObject({ type: 'ok' });
      expect(deps.logger.warn).toHaveBeenCalled();
    });

    it('stamps cooldown after cascade completes, not before', async () => {
      const deps = makeDeps();
      const order: string[] = [];
      deps.memoryRepository.softForgetChildNodes.mockImplementation(async () => {
        order.push('memory');
        return 0;
      });
      deps.childPreferencesRepository.deleteByChild.mockImplementation(async () => {
        order.push('prefs');
        return 0;
      });
      deps.childrenRepository.setFlavorJourneyResetAt.mockImplementation(async () => {
        order.push('stamp');
      });
      const svc = new FlavorJourneyResetService(deps as never);

      await svc.reset(CHILD_ID, HOUSEHOLD_ID, USER_ID, REQUEST_ID);

      expect(order).toEqual(['memory', 'prefs', 'stamp']);
    });
  });
});
