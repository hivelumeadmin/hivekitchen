import { describe, it, expect, vi } from 'vitest';
import { HeartNoteService } from './heart-note.service.js';
import type {
  HeartNoteRepository,
  HeartNoteRow,
  CreateHeartNoteParams,
  PatchHeartNoteParams,
} from './heart-note.repository.js';
import { ConflictError, NotFoundError } from '../../common/errors.js';

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
    delivered_at: null,
    cancelled_at: null,
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
    findById: vi.fn(),
    listByHousehold: vi.fn(),
    deliverScheduled: vi.fn(),
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
  it('returns the updated row on a content-only edit of a draft', async () => {
    const repo = makeRepo();
    const existing = sampleRow();
    const updated = sampleRow({ content: 'edited' });
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(existing);
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
    expect(call?.[2].content).toBe('edited');
    // No transition for content-only edit on a draft.
    expect(call?.[2].status).toBeUndefined();
    expect(call?.[2].cancelledAt).toBeUndefined();
  });

  it('throws NotFoundError when the pre-fetch finds nothing (wrong household or missing)', async () => {
    const repo = makeRepo();
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const service = new HeartNoteService(repo);
    await expect(
      service.patchNote(NOTE_ID, OTHER_HOUSEHOLD_ID, { content: 'edited' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.patch).not.toHaveBeenCalled();
  });

  it('passes through scheduled_for: null on a draft (no schedule, no status change)', async () => {
    const repo = makeRepo();
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sampleRow());
    (repo.patch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sampleRow());

    const service = new HeartNoteService(repo);
    await service.patchNote(NOTE_ID, HOUSEHOLD_ID, { scheduled_for: null });

    const call = (repo.patch as ReturnType<typeof vi.fn>).mock.calls[0] as
      | [string, string, PatchHeartNoteParams]
      | undefined;
    expect(call?.[2].scheduledFor).toBeNull();
    expect(call?.[2].status).toBeUndefined();
  });
});

describe('HeartNoteService.patchNote — status transitions', () => {
  it('draft + scheduled_for set → transitions to scheduled', async () => {
    const repo = makeRepo();
    const existing = sampleRow({ status: 'draft' });
    const updated = sampleRow({ status: 'scheduled', scheduled_for: '2026-05-30' });
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(existing);
    (repo.patch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);

    const service = new HeartNoteService(repo);
    await service.patchNote(NOTE_ID, HOUSEHOLD_ID, { scheduled_for: '2026-05-30' });

    const call = (repo.patch as ReturnType<typeof vi.fn>).mock.calls[0] as
      | [string, string, PatchHeartNoteParams]
      | undefined;
    expect(call?.[2].status).toBe('scheduled');
    expect(call?.[2].scheduledFor).toBe('2026-05-30');
    expect(call?.[2].cancelledAt).toBeUndefined();
  });

  it('scheduled + scheduled_for=null → reverts to draft', async () => {
    const repo = makeRepo();
    const existing = sampleRow({ status: 'scheduled', scheduled_for: '2026-05-30' });
    const updated = sampleRow({ status: 'draft', scheduled_for: null });
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(existing);
    (repo.patch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);

    const service = new HeartNoteService(repo);
    await service.patchNote(NOTE_ID, HOUSEHOLD_ID, { scheduled_for: null });

    const call = (repo.patch as ReturnType<typeof vi.fn>).mock.calls[0] as
      | [string, string, PatchHeartNoteParams]
      | undefined;
    expect(call?.[2].status).toBe('draft');
    expect(call?.[2].scheduledFor).toBeNull();
  });

  it('scheduled + status=cancelled → transitions to cancelled and sets cancelledAt', async () => {
    const repo = makeRepo();
    const existing = sampleRow({ status: 'scheduled', scheduled_for: '2026-05-30' });
    const updated = sampleRow({
      status: 'cancelled',
      scheduled_for: '2026-05-30',
      cancelled_at: '2026-05-28T12:00:00.000Z',
    });
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(existing);
    (repo.patch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);

    const service = new HeartNoteService(repo);
    await service.patchNote(NOTE_ID, HOUSEHOLD_ID, { status: 'cancelled' });

    const call = (repo.patch as ReturnType<typeof vi.fn>).mock.calls[0] as
      | [string, string, PatchHeartNoteParams]
      | undefined;
    expect(call?.[2].status).toBe('cancelled');
    expect(typeof call?.[2].cancelledAt).toBe('string');
  });

  it('throws ConflictError when patching a delivered note', async () => {
    const repo = makeRepo();
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sampleRow({ status: 'delivered', delivered_at: '2026-05-28T06:00:00.000Z' }),
    );

    const service = new HeartNoteService(repo);
    await expect(
      service.patchNote(NOTE_ID, HOUSEHOLD_ID, { content: 'too late' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(repo.patch).not.toHaveBeenCalled();
  });

  it('throws ConflictError when cancelling a draft note', async () => {
    const repo = makeRepo();
    (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sampleRow({ status: 'draft' }),
    );

    const service = new HeartNoteService(repo);
    await expect(
      service.patchNote(NOTE_ID, HOUSEHOLD_ID, { status: 'cancelled' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(repo.patch).not.toHaveBeenCalled();
  });
});

describe('HeartNoteService.listNotes', () => {
  it('delegates to repository.listByHousehold and returns rows', async () => {
    const repo = makeRepo();
    const rows = [sampleRow({ status: 'scheduled', scheduled_for: '2026-05-30' })];
    (repo.listByHousehold as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

    const service = new HeartNoteService(repo);
    const result = await service.listNotes(HOUSEHOLD_ID, { status: ['scheduled'] });

    expect(result).toBe(rows);
    expect(repo.listByHousehold).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      status: ['scheduled'],
    });
  });
});
