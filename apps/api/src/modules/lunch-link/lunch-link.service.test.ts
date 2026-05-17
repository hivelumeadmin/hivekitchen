import { describe, it, expect, vi } from 'vitest';
import { LunchLinkService } from './lunch-link.service.js';
import type { LunchLinkRepository } from './lunch-link.repository.js';
import type {
  HeartNoteRepository,
  HeartNoteRow,
} from '../heart-notes/heart-note.repository.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const DATE = '2026-05-17';

function sampleNoteRow(overrides: Partial<HeartNoteRow> = {}): HeartNoteRow {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    household_id: HOUSEHOLD_ID,
    child_id: CHILD_ID,
    author_user_id: '11111111-1111-4111-8111-111111111111',
    content: 'Hope today is calm.',
    status: 'draft',
    scheduled_for: null,
    created_at: '2026-05-17T12:00:00.000Z',
    updated_at: '2026-05-17T12:00:00.000Z',
    ...overrides,
  };
}

function buildService(opts: {
  childName: string | null;
  noteRow: HeartNoteRow | null;
}): {
  service: LunchLinkService;
  lunchLinkRepo: { findChildName: ReturnType<typeof vi.fn> };
  heartNoteRepo: { findByChildAndDate: ReturnType<typeof vi.fn> };
} {
  const lunchLinkRepo = {
    findChildName: vi.fn().mockResolvedValue(opts.childName),
  };
  const heartNoteRepo = {
    findByChildAndDate: vi.fn().mockResolvedValue(opts.noteRow),
  };
  const service = new LunchLinkService(
    lunchLinkRepo as unknown as LunchLinkRepository,
    heartNoteRepo as unknown as HeartNoteRepository,
  );
  return { service, lunchLinkRepo, heartNoteRepo };
}

describe('LunchLinkService.getDevPayload', () => {
  it('returns null when child is not in household', async () => {
    const { service, heartNoteRepo } = buildService({ childName: null, noteRow: null });

    const result = await service.getDevPayload(HOUSEHOLD_ID, CHILD_ID, DATE);

    expect(result).toBeNull();
    // No reason to look up the heart note when the child does not belong to the caller.
    expect(heartNoteRepo.findByChildAndDate).not.toHaveBeenCalled();
  });

  it('returns payload with heartNote: null when no draft exists', async () => {
    const { service } = buildService({ childName: 'Layla', noteRow: null });

    const result = await service.getDevPayload(HOUSEHOLD_ID, CHILD_ID, DATE);

    expect(result).not.toBeNull();
    expect(result?.childName).toBe('Layla');
    expect(result?.date).toBe(DATE);
    expect(result?.heartNote).toBeNull();
  });

  it('returns payload with populated heartNote when a draft exists', async () => {
    const { service } = buildService({
      childName: 'Layla',
      noteRow: sampleNoteRow({ content: 'A warm note for you.' }),
    });

    const result = await service.getDevPayload(HOUSEHOLD_ID, CHILD_ID, DATE);

    expect(result?.heartNote).toEqual({
      body: 'A warm note for you.',
      authorDisplayName: 'Parent',
    });
  });

  it('always returns the hardcoded stub bag (not from DB)', async () => {
    const { service } = buildService({ childName: 'Layla', noteRow: null });

    const result = await service.getDevPayload(HOUSEHOLD_ID, CHILD_ID, DATE);

    expect(result?.bag).toEqual({
      name: 'Sandwich, apple & water',
      sub: 'Packed for you today',
      safetyNote: 'Nut-free',
    });
  });
});
