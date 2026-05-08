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
