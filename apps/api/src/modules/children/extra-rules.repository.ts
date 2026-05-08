import { BaseRepository } from '../../repository/base.repository.js';
import type { ExtraRules } from '@hivekitchen/types';

const DEFAULT_RULES: ExtraRules = { pins: [], bans: [] };

// Story 3.21 — per-child Extra slot pin/ban rules. Stored as a JSONB column
// on `children`; a separate repository keeps the encryption-aware
// ChildrenRepository unchanged (extra_rules contains no PII — only generic
// component-type labels).
export class ExtraRulesRepository extends BaseRepository {
  async updateExtraRules(opts: {
    childId: string;
    householdId: string;
    pins: string[];
    bans: string[];
  }): Promise<{ child_id: string; extra_rules: ExtraRules; updated_at: string } | null> {
    const next: ExtraRules = { pins: opts.pins, bans: opts.bans };
    const { data, error } = await this.client
      .from('children')
      .update({ extra_rules: next, updated_at: new Date().toISOString() })
      // Both filters together prevent a token from a different household
      // overwriting a row by guessing the child id.
      .eq('id', opts.childId)
      .eq('household_id', opts.householdId)
      .select('id, extra_rules, updated_at')
      .maybeSingle();
    if (error) throw error;
    if (data === null) return null;
    const row = data as { id: string; extra_rules: unknown; updated_at: string };
    return {
      child_id: row.id,
      extra_rules: parseExtraRules(row.extra_rules),
      updated_at: row.updated_at,
    };
  }

  // Read used by the GET /v1/children/:id/extra-rules route. Returns null when
  // the child does not exist or belongs to a different household so the caller
  // can distinguish 404 from a row with default empty rules.
  async findExtraRulesForChild(childId: string, householdId: string): Promise<ExtraRules | null> {
    const { data, error } = await this.client
      .from('children')
      .select('extra_rules')
      .eq('id', childId)
      .eq('household_id', householdId)
      .maybeSingle();
    if (error) throw error;
    if (data === null) return null;
    return parseExtraRules((data as { extra_rules: unknown }).extra_rules);
  }

  // Atomic append used by passive-bias application (Story 3.22). Performs the
  // "is the type already in bans?" check and the array append in a single
  // UPDATE so two concurrent applyBias calls for different component types
  // cannot stomp each other's writes (read-then-write would lose one ban).
  // Returns null only when no row matches (id + household_id) — the caller
  // treats that as a soft failure and leaves the removal signals unapplied
  // so a later swap can retry.
  async appendBanAtomic(opts: {
    childId: string;
    householdId: string;
    componentType: string;
  }): Promise<{ extra_rules: ExtraRules; status: 'appended' | 'already_banned' } | null> {
    const { data, error } = await this.client.rpc('append_extra_ban', {
      p_child_id: opts.childId,
      p_household_id: opts.householdId,
      p_component_type: opts.componentType,
    });
    if (error) throw error;
    // RETURNS TABLE(...) yields an array of rows over PostgREST.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const status = (row as { status?: unknown }).status;
    if (status === 'not_found') return null;
    if (status !== 'appended' && status !== 'already_banned') return null;
    return {
      extra_rules: parseExtraRules((row as { extra_rules?: unknown }).extra_rules),
      status,
    };
  }

  // Read used by the plan-generation pipeline to inject rules into the planner
  // prompt. Returns the default empty rules for any row missing the column
  // (e.g. local DB pre-migration) so the worker never crashes on a fresh row.
  async findExtraRules(childId: string): Promise<ExtraRules> {
    const { data, error } = await this.client
      .from('children')
      .select('extra_rules')
      .eq('id', childId)
      .maybeSingle();
    if (error) throw error;
    if (data === null) return { ...DEFAULT_RULES };
    return parseExtraRules((data as { extra_rules: unknown }).extra_rules);
  }
}

// PostgREST returns JSONB pre-parsed, but tolerate a raw string defensively
// (some test fixtures still hand back the underlying text).
export function parseExtraRules(raw: unknown): ExtraRules {
  let parsed: unknown = raw ?? {};
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_RULES };
    }
  }
  const obj: { pins?: unknown; bans?: unknown } =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { pins?: unknown; bans?: unknown })
      : {};
  return {
    pins: Array.isArray(obj.pins) ? obj.pins.filter((p): p is string => typeof p === 'string') : [],
    bans: Array.isArray(obj.bans) ? obj.bans.filter((b): b is string => typeof b === 'string') : [],
  };
}
