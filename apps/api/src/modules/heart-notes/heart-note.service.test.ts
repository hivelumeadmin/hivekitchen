import { describe, it, expect, vi } from 'vitest';
import { HeartNoteService } from './heart-note.service.js';
import type {
  HeartNoteRepository,
  HeartNoteRow,
  CreateHeartNoteParams,
  PatchHeartNoteParams,
} from './heart-note.repository.js';
import { NotFoundError } from '../../common/errors.js';

const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HOUSEHOLD_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

function sampleRow(overrides: Partial<HeartNoteRow> = {}): HeartNoteRow {
  return {
    id: NOTE_ID,
    household_id: HOUSEHOLD_ID,
    child_id: CHILD_ID,
    author_user_id: USER_ID,
    content: 'hello',
    status: 'draft',
    scheduled_for: null,
    created_at: '2026-05-15T12:00:00.000Z',
    updated_at: '2026-05-15T12:00:00.000Z',
    ...overrides,
  };
}

function makeRepo(childValid = true): HeartNoteRepository {
  return {
    childBelongsToHousehold: vi.fn().mockResolvedValue(childValid),
    create: vi.fn(),
    findByChildAndDate: vi.fn(),
    patch: vi.fn(),
  } as unknown as HeartNoteRepository;
}

describe('HeartNoteService.createDraft', () => {
  it('passes body fields through to repository.create', async () => {
    const repo = makeRepo();
    const row = sampleRow();
    (repo.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);

    const service = new HeartNoteService(repo);
    const result = await service.createDraft(HOUSEHOLD_ID, USER_ID, {
      child_id: CHILD_ID,
      content: 'a fresh note',
      scheduled_for: '2026-05-20',
    });

    expect(result).toBe(row);
    const call = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | CreateHeartNoteParams
      | undefined;
    expect(call).toEqual({
      householdId: HOUSEHOLD_ID,
      childId: CHILD_ID,
      authorUserId: USER_ID,
      content: 'a fresh note',
      scheduledFor: '2026-05-20',
    });
  });

  it('omits scheduled_for when not provided', async () => {
    const repo = makeRepo();
    (repo.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sampleRow());

    const service = new HeartNoteService(repo);
    await service.createDraft(HOUSEHOLD_ID, USER_ID, {
      child_id: CHILD_ID,
      content: '',
    });

    const call = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | CreateHeartNoteParams
      | undefined;
    expect(call?.scheduledFor).toBeUndefined();
  });

  it('throws NotFoundError when child_id does not belong to household', async () => {
    const repo = makeRepo(false);

    const service = new HeartNoteService(repo);
    await expect(
      service.createDraft(HOUSEHOLD_ID, USER_ID, { child_id: CHILD_ID, content: '' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('HeartNoteService.getDraft', () => {
  it('returns the row when one exists', async () => {
    const repo = makeRepo();
    const row = sampleRow();
    (repo.findByChildAndDate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);

    const service = new HeartNoteService(repo);
    const result = await service.getDraft(HOUSEHOLD_ID, CHILD_ID, '2026-05-15');

    expect(result).toBe(row);
    expect(repo.findByChildAndDate).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CHILD_ID,
      '2026-05-15',
    );
  });

  it('returns null when no row exists', async () => {
    const repo = makeRepo();
    (repo.findByChildAndDate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const service = new HeartNoteService(repo);
    const result = await service.getDraft(HOUSEHOLD_ID, CHILD_ID, '2026-05-15');

    expect(result).toBeNull();
  });
});

describe('HeartNoteService.patchNote', () => {
  it('returns the updated row on success', async () => {
    const repo = makeRepo();
    const updated = sampleRow({ content: 'edited' });
    (repo.patch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);

    const service = new HeartNoteService(repo);
    const result = await service.patchNote(NOTE_ID, HOUSEHOLD_ID, {
      content: 'edited',
    });

    expect(result).toBe(updated);
    const call = (repo.patch as ReturnType<typeof vi.fn>).mock.calls[0] as
      | [string, string, PatchHeartNoteParams]
      | undefined;
    expect(call?.[0]).toBe(NOTE_ID);
    expect(call?.[1]).toBe(HOUSEHOLD_ID);
    expect(call?.[2]).toEqual({ content: 'edited', scheduledFor: undefined });
  });

  it('throws NotFoundError when repository returns null (wrong household or missing)', async () => {
    const repo = makeRepo();
    (repo.patch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const service = new HeartNoteService(repo);
    await expect(
      service.patchNote(NOTE_ID, OTHER_HOUSEHOLD_ID, { content: 'edited' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('passes through scheduled_for: null (cancellation of schedule)', async () => {
    const repo = makeRepo();
    (repo.patch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sampleRow());

    const service = new HeartNoteService(repo);
    await service.patchNote(NOTE_ID, HOUSEHOLD_ID, { scheduled_for: null });

    const call = (repo.patch as ReturnType<typeof vi.fn>).mock.calls[0] as
      | [string, string, PatchHeartNoteParams]
      | undefined;
    expect(call?.[2].scheduledFor).toBeNull();
  });
});
