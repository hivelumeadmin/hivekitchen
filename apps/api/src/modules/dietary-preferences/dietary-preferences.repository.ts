import type { SupabaseClient } from '@supabase/supabase-js';

// Slice 2.5-s6 — Structured (household-or-child)-scoped dietary identity rows.
// Closed vocabulary — tag is plaintext (validated by VocabularyService at the
// tool layer). The unique index is functional
// (household_id, COALESCE(child_id, sentinel), tag); Supabase upsert
// onConflict on functional indexes can fail with Postgres 42P10, so the
// implementation falls back to insert + 23505-catch + select on that path.

const UNIQUE_VIOLATION_CODE = '23505';
const NO_UNIQUE_CONSTRAINT_CODE = '42P10';

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export class DietaryPreferencesRepository {
  constructor(private readonly client: SupabaseClient) {}

  async declare(
    householdId: string,
    childId: string | null,
    tag: string,
    enforcement: string,
    source: string,
  ): Promise<{ dietary_id: string; was_existing: boolean }> {
    // Primary path: upsert with onConflict on the functional unique index.
    const { data, error } = await this.client
      .from('dietary_preferences')
      .upsert(
        {
          household_id: householdId,
          child_id: childId,
          tag,
          enforcement,
          source,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'household_id,child_id,tag',
          ignoreDuplicates: false,
        },
      )
      .select('id, created_at, updated_at')
      .maybeSingle();

    if (error === null || error === undefined) {
      if (data === null) {
        throw new Error('dietary_preferences.declare: no row returned');
      }
      const row = data as { id: string; created_at: string; updated_at: string };
      const was_existing =
        Math.abs(new Date(row.updated_at).getTime() - new Date(row.created_at).getTime()) > 1000;
      return { dietary_id: row.id, was_existing };
    }

    // Fallback: Supabase cannot use ON CONFLICT against a functional index.
    // Insert → 23505 → SELECT existing row.
    if (pgErrorCode(error) !== NO_UNIQUE_CONSTRAINT_CODE) {
      throw new Error(`dietary_preferences.declare: ${(error as { message?: string }).message ?? 'unknown error'}`);
    }
    return this.declareViaInsertFallback(householdId, childId, tag, enforcement, source);
  }

  private async declareViaInsertFallback(
    householdId: string,
    childId: string | null,
    tag: string,
    enforcement: string,
    source: string,
  ): Promise<{ dietary_id: string; was_existing: boolean }> {
    const { data: inserted, error: insertErr } = await this.client
      .from('dietary_preferences')
      .insert({
        household_id: householdId,
        child_id: childId,
        tag,
        enforcement,
        source,
      })
      .select('id')
      .maybeSingle();

    if (insertErr === null || insertErr === undefined) {
      if (inserted === null) {
        throw new Error('dietary_preferences.declare: insert returned no row');
      }
      return { dietary_id: (inserted as { id: string }).id, was_existing: false };
    }

    if (pgErrorCode(insertErr) !== UNIQUE_VIOLATION_CODE) {
      throw new Error(
        `dietary_preferences.declare: ${(insertErr as { message?: string }).message ?? 'unknown error'}`,
      );
    }

    // 23505: scope+tag already exists — select it. For household-scoped rows
    // child_id is NULL in the DB, but the unique index compares using the
    // sentinel UUID. Use the explicit `.is('child_id', null)` filter when
    // childId is null; otherwise eq on the supplied id.
    let selectQuery = this.client
      .from('dietary_preferences')
      .select('id')
      .eq('household_id', householdId)
      .eq('tag', tag);
    selectQuery = childId === null
      ? selectQuery.is('child_id', null)
      : selectQuery.eq('child_id', childId);
    const { data: existing, error: selectErr } = await selectQuery.maybeSingle();

    if (selectErr !== null && selectErr !== undefined) {
      throw new Error(
        `dietary_preferences.declare: ${(selectErr as { message?: string }).message ?? 'unknown error'}`,
      );
    }
    if (existing === null) {
      throw new Error('dietary_preferences.declare: conflict claimed but no row found');
    }
    const existingId = (existing as { id: string }).id;

    // Refresh enforcement and source on the existing row so re-declares with a
    // stronger enforcement (e.g. default → non_negotiable) are not silently dropped.
    await this.client
      .from('dietary_preferences')
      .update({ enforcement, source, updated_at: new Date().toISOString() })
      .eq('id', existingId);

    return { dietary_id: existingId, was_existing: true };
  }
}

