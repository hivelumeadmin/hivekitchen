import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from '../../repository/base.repository.js';
import type { HeartNoteStatus } from '@hivekitchen/contracts';

export interface HeartNoteRow {
  id: string;
  household_id: string;
  child_id: string;
  author_user_id: string;
  content: string;
  status: HeartNoteStatus;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateHeartNoteParams {
  householdId: string;
  childId: string;
  authorUserId: string;
  content: string;
  scheduledFor?: string;
}

export interface PatchHeartNoteParams {
  content?: string;
  scheduledFor?: string | null;
}

const HEART_NOTE_COLUMNS =
  'id, household_id, child_id, author_user_id, content, status, scheduled_for, created_at, updated_at';

export class HeartNoteRepository extends BaseRepository {
  constructor(client: SupabaseClient) {
    super(client);
  }

  async create(params: CreateHeartNoteParams): Promise<HeartNoteRow> {
    const { data, error } = await this.client
      .from('heart_notes')
      .insert({
        household_id: params.householdId,
        child_id: params.childId,
        author_user_id: params.authorUserId,
        content: params.content,
        scheduled_for: params.scheduledFor ?? null,
      })
      .select(HEART_NOTE_COLUMNS)
      .single();
    if (error) throw error;
    return data as HeartNoteRow;
  }

  // Finds the most recently updated note for (household, child, date) — the
  // route uses `created_at::date = :date` semantics so a draft started today
  // is returned for today's compose surface. If multiple draft rows exist
  // (e.g. two tabs racing first POST), the most-recent wins; rest are
  // ignored by S1 — the dedupe job lives in a later slice.
  async findByChildAndDate(
    householdId: string,
    childId: string,
    isoDate: string,
  ): Promise<HeartNoteRow | null> {
    const dayStart = `${isoDate}T00:00:00.000Z`;
    const nextDayStart = nextIsoDate(isoDate);
    const { data, error } = await this.client
      .from('heart_notes')
      .select(HEART_NOTE_COLUMNS)
      .eq('household_id', householdId)
      .eq('child_id', childId)
      .gte('created_at', dayStart)
      .lt('created_at', `${nextDayStart}T00:00:00.000Z`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as HeartNoteRow | null) ?? null;
  }

  // Ownership check without decryption: only selects the id column so
  // no DEK is required. Used by HeartNoteService.createDraft() to reject
  // a child_id that belongs to a different household.
  async childBelongsToHousehold(childId: string, householdId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('children')
      .select('id')
      .eq('id', childId)
      .eq('household_id', householdId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  }

  async patch(
    id: string,
    householdId: string,
    params: PatchHeartNoteParams,
  ): Promise<HeartNoteRow | null> {
    // Build the update payload only with provided fields so PATCH semantics
    // are preserved (omitted fields stay untouched).
    const update: Record<string, unknown> = {};
    if (params.content !== undefined) update.content = params.content;
    if (params.scheduledFor !== undefined) update.scheduled_for = params.scheduledFor;
    // updated_at trigger handles the timestamp.

    const { data, error } = await this.client
      .from('heart_notes')
      .update(update)
      .eq('id', id)
      .eq('household_id', householdId)
      .select(HEART_NOTE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data as HeartNoteRow | null) ?? null;
  }
}

// YYYY-MM-DD + 1 day as YYYY-MM-DD. Uses UTC arithmetic so dates don't drift
// across the DST boundary in any caller timezone.
function nextIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
