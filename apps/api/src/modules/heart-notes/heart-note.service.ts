import type {
  CreateHeartNoteBody,
  HeartNoteStatus,
  PatchHeartNoteBody,
} from '@hivekitchen/contracts';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import type { HeartNoteRepository, HeartNoteRow } from './heart-note.repository.js';

// Slice 4-S6 — once a note reaches one of these statuses it is immutable.
// `delivered` is system-only (delivery job); `viewed` / `rated` are set by
// later slices; `cancelled` is final by definition.
const TERMINAL_STATUSES: readonly HeartNoteStatus[] = [
  'delivered',
  'viewed',
  'rated',
  'cancelled',
];

export class HeartNoteService {
  constructor(private readonly repo: HeartNoteRepository) {}

  async createDraft(
    householdId: string,
    authorUserId: string,
    body: CreateHeartNoteBody,
  ): Promise<HeartNoteRow> {
    const childValid = await this.repo.childBelongsToHousehold(body.child_id, householdId);
    if (!childValid) throw new NotFoundError('child not found');
    return this.repo.create({
      householdId,
      childId: body.child_id,
      authorUserId,
      content: body.content,
      scheduledFor: body.scheduled_for,
    });
  }

  async getDraft(
    householdId: string,
    childId: string,
    isoDate: string,
  ): Promise<HeartNoteRow | null> {
    return this.repo.findByChildAndDate(householdId, childId, isoDate);
  }

  async patchNote(
    id: string,
    householdId: string,
    body: PatchHeartNoteBody,
  ): Promise<HeartNoteRow> {
    // Pre-fetch the current row so we can validate the transition before
    // issuing the UPDATE. The 404 here covers both "no such note" and
    // "belongs to a different household" (the .eq(household_id) filter).
    const existing = await this.repo.findById(id, householdId);
    if (existing === null) throw new NotFoundError('Heart note not found');

    if (TERMINAL_STATUSES.includes(existing.status)) {
      throw new ConflictError('Cannot modify a delivered or cancelled note');
    }

    let resolvedStatus: HeartNoteStatus | undefined;
    let cancelledAt: string | undefined;

    if (body.status === 'cancelled') {
      if (existing.status !== 'scheduled') {
        throw new ConflictError('Only scheduled notes can be cancelled');
      }
      resolvedStatus = 'cancelled';
      cancelledAt = new Date().toISOString();
    } else if (body.scheduled_for != null && existing.status === 'draft') {
      // Setting a date on a draft auto-schedules it.
      resolvedStatus = 'scheduled';
    } else if (body.scheduled_for === null && existing.status === 'scheduled') {
      // Clearing the date on a scheduled note reverts it to draft.
      resolvedStatus = 'draft';
    }

    const updated = await this.repo.patch(id, householdId, {
      content: body.content,
      scheduledFor: body.scheduled_for,
      status: resolvedStatus,
      cancelledAt,
      currentStatus: existing.status,
    });
    // Null means the optimistic-lock predicate (.eq status = existing.status)
    // found no matching row — the note was concurrently modified (e.g. the
    // delivery job flipped it to 'delivered' between our pre-fetch and UPDATE).
    if (updated === null) throw new ConflictError('Note was modified concurrently');
    return updated;
  }

  async listNotes(
    householdId: string,
    filters?: { status?: HeartNoteStatus[] },
  ): Promise<HeartNoteRow[]> {
    return this.repo.listByHousehold(householdId, filters);
  }
}
