import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from '../../repository/base.repository.js';

interface SuppressedSession {
  child_id: string;
  household_id: string;
}

export class LunchLinkSessionRepository extends BaseRepository {
  constructor(client: SupabaseClient) {
    super(client);
  }

  // Create or update suppressed_at on a lunch_link_session row.
  async suppress(opts: {
    householdId: string;
    childId: string;
    date: string;
    userId: string;
  }): Promise<void> {
    const { error } = await this.client
      .from('lunch_link_sessions')
      .upsert(
        {
          household_id: opts.householdId,
          child_id: opts.childId,
          date: opts.date,
          suppressed_at: new Date().toISOString(),
          suppressed_by_user_id: opts.userId,
        },
        { onConflict: 'child_id,date' },
      );
    if (error) throw error;
  }

  // Clear suppression (un-pause).
  async unsuppress(opts: {
    householdId: string;
    childId: string;
    date: string;
  }): Promise<void> {
    const { error } = await this.client
      .from('lunch_link_sessions')
      .update({ suppressed_at: null, suppressed_by_user_id: null })
      .eq('household_id', opts.householdId)
      .eq('child_id', opts.childId)
      .eq('date', opts.date);
    if (error) throw error;
  }

  async findByChildAndDate(
    householdId: string,
    childId: string,
    date: string,
  ): Promise<{ suppressed_at: string | null } | null> {
    const { data, error } = await this.client
      .from('lunch_link_sessions')
      .select('suppressed_at')
      .eq('household_id', householdId)
      .eq('child_id', childId)
      .eq('date', date)
      .maybeSingle();
    if (error) throw error;
    return (data as { suppressed_at: string | null } | null) ?? null;
  }

  // Used by the delivery job to skip suppressed sessions.
  async findSuppressedForDate(date: string): Promise<SuppressedSession[]> {
    const { data, error } = await this.client
      .from('lunch_link_sessions')
      .select('child_id, household_id')
      .eq('date', date)
      .not('suppressed_at', 'is', null);
    if (error) throw error;
    return (data ?? []) as SuppressedSession[];
  }

  // Bulk read for brief_state.composer: returns the set of dates (YYYY-MM-DD)
  // within [dateFrom, dateTo] that have at least one suppressed session for
  // the given household. One query per brief refresh instead of per-day calls.
  async findSuppressedDatesInRange(
    householdId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<Set<string>> {
    const { data, error } = await this.client
      .from('lunch_link_sessions')
      .select('date')
      .eq('household_id', householdId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .not('suppressed_at', 'is', null);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ date: string }>;
    return new Set(rows.map((r) => r.date));
  }

  // D1-C: per-child suppression map for brief_state.composer. Returns a map
  // of date → child_id[] for all suppressed sessions in the given range.
  // Replaces the day-level boolean with per-child granularity so the frontend
  // can show "Resume" only for the specific child(ren) who are paused.
  async findSuppressedChildrenInRange(
    householdId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<Map<string, string[]>> {
    const { data, error } = await this.client
      .from('lunch_link_sessions')
      .select('date, child_id')
      .eq('household_id', householdId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .not('suppressed_at', 'is', null);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ date: string; child_id: string }>;
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const existing = map.get(row.date) ?? [];
      existing.push(row.child_id);
      map.set(row.date, existing);
    }
    return map;
  }
}
