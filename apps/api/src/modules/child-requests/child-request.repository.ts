import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from '../../repository/base.repository.js';
import { NotFoundError } from '../../common/errors.js';

// Slice 4-S15 — Child Request-a-Lunch + Parent Approval.

export interface ChildRequestRow {
  id: string;
  household_id: string;
  child_id: string;
  session_id: string;
  request_text: string;
  status: string;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  created_at: string;
}

// Internal to the repository response — child_name is joined from children.name
// at query time, so this is not a stored shape and needs no contract.
export interface ChildRequestWithChildName {
  id: string;
  child_id: string;
  child_name: string;
  request_text: string;
  status: string;
  created_at: string;
}

interface PendingRow {
  id: string;
  child_id: string;
  request_text: string;
  status: string;
  created_at: string;
  // supabase-js embeds a to-one FK as an object but widens the typing to
  // object | array; normalizeEmbedded copes.
  children: { name: string } | { name: string }[] | null;
}

function normalizeEmbedded<T>(value: T | T[] | null): T | null {
  if (value === null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export class ChildRequestRepository extends BaseRepository {
  constructor(client: SupabaseClient) {
    super(client);
  }

  // Insert a new request. A duplicate on session_id raises the UNIQUE-violation
  // (23505) — propagated raw so the service can map it to a 409 ConflictError.
  async create(input: {
    householdId: string;
    childId: string;
    sessionId: string;
    requestText: string;
  }): Promise<ChildRequestRow> {
    const { data, error } = await this.client
      .from('child_lunch_requests')
      .insert({
        household_id: input.householdId,
        child_id: input.childId,
        session_id: input.sessionId,
        request_text: input.requestText,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as ChildRequestRow;
  }

  // Pending requests for the household, newest first, with the child's name
  // joined in for parent-facing display.
  async findPendingByHousehold(householdId: string): Promise<ChildRequestWithChildName[]> {
    const { data, error } = await this.client
      .from('child_lunch_requests')
      .select('id, child_id, request_text, status, created_at, children(name)')
      .eq('household_id', householdId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;

    return ((data ?? []) as PendingRow[]).map((row) => {
      const child = normalizeEmbedded(row.children);
      return {
        id: row.id,
        child_id: row.child_id,
        child_name: child?.name ?? '',
        request_text: row.request_text,
        status: row.status,
        created_at: row.created_at,
      };
    });
  }

  // Household-scoped lookup — returns null when the id is not in the caller's
  // household (no cross-household data-leak oracle).
  async findById(id: string, householdId: string): Promise<ChildRequestRow | null> {
    const { data, error } = await this.client
      .from('child_lunch_requests')
      .select('*')
      .eq('id', id)
      .eq('household_id', householdId)
      .maybeSingle();
    if (error) throw error;
    return (data as ChildRequestRow | null) ?? null;
  }

  // Plaintext child name for the household — used only to label the best-effort
  // Lumi planning-thread turn. Returns null when the child is not in the
  // household.
  async findChildName(childId: string, householdId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('children')
      .select('name')
      .eq('id', childId)
      .eq('household_id', householdId)
      .maybeSingle();
    if (error) throw error;
    return (data as { name: string } | null)?.name ?? null;
  }

  // Resolve a pending request. Scoped on status='pending' so a concurrent
  // resolve cannot double-apply; 0 rows updated → NotFoundError (the request was
  // already resolved out from under us). Household ownership is enforced by the
  // service's prior findById and by RLS.
  async resolve(
    id: string,
    opts: { status: 'approved' | 'declined'; resolvedByUserId: string },
  ): Promise<void> {
    const { data, error } = await this.client
      .from('child_lunch_requests')
      .update({
        status: opts.status,
        resolved_at: new Date().toISOString(),
        resolved_by_user_id: opts.resolvedByUserId,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) throw error;
    if (data === null || (data as unknown[]).length === 0) {
      throw new NotFoundError('Request not found or already resolved');
    }
  }
}
