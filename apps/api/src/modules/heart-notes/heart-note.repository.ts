import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from '../../repository/base.repository.js';
import { decryptField, encryptField } from '../../lib/envelope-encryption.js';
import { getHouseholdDek, getOrCreateHouseholdDek } from '../../lib/household-key.js';
import type { HeartNoteStatus } from '@hivekitchen/contracts';

export interface HeartNoteRow {
  id: string;
  household_id: string;
  child_id: string;
  author_user_id: string;
  content: string;
  status: HeartNoteStatus;
  scheduled_for: string | null;
  // Slice 4-S6 — set by the delivery job when status flips to 'delivered'.
  delivered_at: string | null;
  // Slice 4-S6 — set by patchNote when transitioning scheduled → cancelled.
  cancelled_at: string | null;
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
  // Slice 4-S6 — service resolves the target status (e.g. draft→scheduled,
  // scheduled→cancelled) and passes it through; the repo just writes it.
  status?: HeartNoteStatus;
  // Slice 4-S6 — ISO timestamp set by the service on transition to cancelled.
  cancelledAt?: string;
  // Slice 4-S6 review patch — optimistic lock: UPDATE only succeeds if the
  // row's current status matches what the service read in its pre-fetch.
  currentStatus?: HeartNoteStatus;
}

const HEART_NOTE_COLUMNS =
  'id, household_id, child_id, author_user_id, content, status, scheduled_for, delivered_at, cancelled_at, created_at, updated_at';

export class HeartNoteRepository extends BaseRepository {
  constructor(
    client: SupabaseClient,
    private readonly kek: Buffer | null,
  ) {
    super(client);
  }

  async create(params: CreateHeartNoteParams): Promise<HeartNoteRow> {
    const dek = await getOrCreateHouseholdDek(this.client, this.kek, params.householdId);
    const encryptedContent = encryptField(params.content, dek);

    const { data, error } = await this.client
      .from('heart_notes')
      .insert({
        household_id: params.householdId,
        child_id: params.childId,
        author_user_id: params.authorUserId,
        content: encryptedContent,
        scheduled_for: params.scheduledFor ?? null,
      })
      .select(HEART_NOTE_COLUMNS)
      .single();
    if (error) throw error;
    const row = data as HeartNoteRow;
    return { ...row, content: params.content };
  }

  // Finds the most recently updated draft note created on the given date —
  // used by the compose surface to re-load a draft the parent started today.
  // Searches by creation date, not scheduled_for, so unscheduled drafts
  // (scheduled_for IS NULL) are always visible to the compose view.
  // If multiple drafts exist for the same (household, child, date), the most-
  // recent wins; the dedupe job lives in a later slice.
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
    const row = (data as HeartNoteRow | null) ?? null;
    if (row === null) return null;
    const dek = await getHouseholdDek(this.client, this.kek, householdId);
    return { ...row, content: decryptField<string>(row.content, dek) };
  }

  // Sacred-channel delivery read path. Named separately from findByChildAndDate
  // so the lint rule (check-sacred-channel-boundary.ts) can detect any file that
  // calls both this method and the LLM orchestrator — a violation of FR38/FR39.
  async findForDelivery(
    householdId: string,
    childId: string,
    isoDate: string,
  ): Promise<HeartNoteRow | null> {
    const { data, error } = await this.client
      .from('heart_notes')
      .select(HEART_NOTE_COLUMNS)
      .eq('household_id', householdId)
      .eq('child_id', childId)
      .eq('scheduled_for', isoDate)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const row = (data as HeartNoteRow | null) ?? null;
    if (row === null) return null;
    const dek = await getHouseholdDek(this.client, this.kek, householdId);
    return { ...row, content: decryptField<string>(row.content, dek) };
  }

  // Slice 4-S6 — id+household pre-fetch used by patchNote to determine the
  // current status before resolving a transition. Read-only: uses
  // getHouseholdDek (not the create variant) so validation never mints a DEK.
  async findById(id: string, householdId: string): Promise<HeartNoteRow | null> {
    const { data, error } = await this.client
      .from('heart_notes')
      .select(HEART_NOTE_COLUMNS)
      .eq('id', id)
      .eq('household_id', householdId)
      .maybeSingle();
    if (error) throw error;
    const row = (data as HeartNoteRow | null) ?? null;
    if (row === null) return null;
    const dek = await getHouseholdDek(this.client, this.kek, householdId);
    return { ...row, content: decryptField<string>(row.content, dek) };
  }

  // Slice 4-S6 — All Notes list. All rows in a household share one DEK, so
  // fetch it once and map over the result. Empty result skips the DEK fetch.
  async listByHousehold(
    householdId: string,
    filters?: { status?: HeartNoteStatus[] },
  ): Promise<HeartNoteRow[]> {
    let query = this.client
      .from('heart_notes')
      .select(HEART_NOTE_COLUMNS)
      .eq('household_id', householdId)
      .order('scheduled_for', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(50);

    if (filters?.status && filters.status.length > 0) {
      query = query.in('status', filters.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data as HeartNoteRow[] | null) ?? [];
    if (rows.length === 0) return [];

    const dek = await getHouseholdDek(this.client, this.kek, householdId);
    return rows.map((row) => ({ ...row, content: decryptField<string>(row.content, dek) }));
  }

  // Slice 4-S6 — bulk-flip 'scheduled' rows for a given date to 'delivered'.
  // Never reads or decrypts content. Returns the number of rows updated.
  async deliverScheduled(isoDate: string): Promise<number> {
    const { data, error } = await this.client
      .from('heart_notes')
      .update({ status: 'delivered', delivered_at: new Date().toISOString() })
      .eq('status', 'scheduled')
      .eq('scheduled_for', isoDate)
      .select('id');
    if (error) throw error;
    return (data as Array<{ id: string }> | null)?.length ?? 0;
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

    // When content changes we need a DEK for the encrypt call; reuse it for
    // the post-update decrypt to avoid a second round-trip. When only
    // scheduled_for is being patched, no encrypt is needed and we fall back
    // to a read-only DEK fetch after the update.
    let dek: Buffer | null = null;
    if (params.content !== undefined) {
      dek = await getOrCreateHouseholdDek(this.client, this.kek, householdId);
      update.content = encryptField(params.content, dek);
    }
    if (params.scheduledFor !== undefined) update.scheduled_for = params.scheduledFor;
    if (params.status !== undefined) update.status = params.status;
    if (params.cancelledAt !== undefined) update.cancelled_at = params.cancelledAt;
    // updated_at trigger handles the timestamp.

    let query = this.client
      .from('heart_notes')
      .update(update)
      .eq('id', id)
      .eq('household_id', householdId);
    if (params.currentStatus !== undefined) {
      query = query.eq('status', params.currentStatus);
    }
    const { data, error } = await query
      .select(HEART_NOTE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    const row = (data as HeartNoteRow | null) ?? null;
    if (row === null) return null;

    if (dek === null) dek = await getHouseholdDek(this.client, this.kek, householdId);
    return { ...row, content: decryptField<string>(row.content, dek) };
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
