import { BaseRepository } from '../../repository/base.repository.js';
import type { ExtraRules } from '@hivekitchen/types';

interface ExtraRuleRow {
  rule: 'pin' | 'ban';
  component_type: string;
}

const UNIQUE_VIOLATION = '23505';
// child_extra_rules.component_type CHECK (char_length BETWEEN 1 AND 50).
// Unlike the retired JSONB column, this is now DB-enforced — a label from an
// unconstrained source (e.g. extra_library.component_type, plain TEXT) can
// still exceed it, so the passive-bias insert path must guard defensively.
const MAX_COMPONENT_TYPE_LENGTH = 50;

// Story 3.21 — per-child Extra slot pin/ban rules. Story 15-s5 moved the
// storage from a JSONB column on `children` to one `child_extra_rules` row per
// rule; the public shape ({pins, bans}) every consumer reads is unchanged.
// A separate repository keeps the encryption-aware ChildrenRepository
// untouched (these rows carry no PII — only generic component-type labels).
export class ExtraRulesRepository extends BaseRepository {
  async updateExtraRules(opts: {
    childId: string;
    householdId: string;
    pins: string[];
    bans: string[];
  }): Promise<{ child_id: string; extra_rules: ExtraRules; updated_at: string } | null> {
    // PATCH is a full replace. DELETE-then-INSERT as two PostgREST calls is not
    // equivalent to the single UPDATE this replaced — a crash between them would
    // leave the child with no rules at all — so both statements live inside one
    // SECURITY DEFINER function. It also carries the (child, household) guard
    // the old `.eq('id').eq('household_id')` pair provided.
    const { data, error } = await this.client.rpc('replace_child_extra_rules', {
      p_child_id: opts.childId,
      p_household_id: opts.householdId,
      p_pins: opts.pins,
      p_bans: opts.bans,
    });
    if (error) throw error;
    const replaced = Array.isArray(data) ? data[0] : data;
    if (replaced !== true) return null;

    // The rows just written are exactly the input; no read-back needed.
    // `updated_at` records when this replace happened — child_extra_rules has no
    // updated_at column because a row is never mutated in place.
    return {
      child_id: opts.childId,
      extra_rules: { pins: [...opts.pins], bans: [...opts.bans] },
      updated_at: new Date().toISOString(),
    };
  }

  // Read used by the GET /v1/children/:id/extra-rules route. Returns null when
  // the child does not exist or belongs to a different household so the caller
  // can distinguish 404 from a child with no rules.
  async findExtraRulesForChild(childId: string, householdId: string): Promise<ExtraRules | null> {
    if (!(await this.childBelongsToHousehold(childId, householdId))) return null;
    return this.loadRules(childId);
  }

  // Ban append used by passive-bias application (Story 3.22). The old
  // `append_extra_ban` RPC existed only to make a read-then-append on a JSONB
  // array safe under concurrency; rows make that unnecessary. Two concurrent
  // appends of *different* component types no longer touch the same record at
  // all, and a repeat of the *same* type is caught by the
  // (child_id, rule, component_type) unique index — the INSERT is the authority,
  // so the containment pre-check below is an optimisation, not the guard.
  // Returns null only when no child matches (id + household_id) — the caller
  // treats that as a soft failure and leaves the removal signals unapplied so a
  // later swap can retry.
  async appendBanAtomic(opts: {
    childId: string;
    householdId: string;
    componentType: string;
  }): Promise<{ extra_rules: ExtraRules; status: 'appended' | 'already_banned' } | null> {
    if (!(await this.childBelongsToHousehold(opts.childId, opts.householdId))) return null;

    // Lowercase on write, compare case-blind on read: the retired RPC did both,
    // and a parent-entered "Sweet Treat" must still suppress a bias ban for
    // "sweet treat". The DB index is deliberately case-sensitive so that
    // ExtraRulesSchema's case-sensitive `unique` refine stays satisfiable.
    const componentType = opts.componentType.trim().toLowerCase();
    if (componentType.length > MAX_COMPONENT_TYPE_LENGTH) {
      // child_extra_rules' CHECK would otherwise reject this with an opaque
      // Postgres error on every retry. Unlike the retired JSONB column,
      // component_type is now length-bounded at the DB layer, but its source
      // (extra_library.component_type) is unconstrained TEXT.
      throw new Error(
        `extra rules component_type exceeds ${MAX_COMPONENT_TYPE_LENGTH} chars: "${componentType}"`,
      );
    }
    const current = await this.loadRules(opts.childId);
    if (current.bans.some((b) => b.toLowerCase() === componentType)) {
      return { extra_rules: current, status: 'already_banned' };
    }

    const { error } = await this.client
      .from('child_extra_rules')
      .insert({ child_id: opts.childId, rule: 'ban', component_type: componentType });
    if (error) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      // A concurrent writer landed the same ban between the check and the
      // insert. Re-read so the caller sees the committed state.
      return { extra_rules: await this.loadRules(opts.childId), status: 'already_banned' };
    }

    return {
      extra_rules: { pins: current.pins, bans: [...current.bans, componentType] },
      status: 'appended',
    };
  }

  // Read used by the plan-generation pipeline to inject rules into the planner
  // prompt. A child with no rows yields empty arrays — the same default the
  // JSONB column's `{"pins":[],"bans":[]}` produced.
  async findExtraRules(childId: string): Promise<ExtraRules> {
    return this.loadRules(childId);
  }

  private async childBelongsToHousehold(childId: string, householdId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('children')
      .select('id')
      .eq('id', childId)
      .eq('household_id', householdId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  }

  private async loadRules(childId: string): Promise<ExtraRules> {
    // Ordered so the rendered planner prompt and the GET response are stable
    // across reads; row storage has no inherent order to inherit.
    const { data, error } = await this.client
      .from('child_extra_rules')
      .select('rule, component_type')
      .eq('child_id', childId)
      .order('component_type', { ascending: true });
    if (error) throw error;
    return groupRules((data ?? []) as ExtraRuleRow[]);
  }
}

function groupRules(rows: ExtraRuleRow[]): ExtraRules {
  const pins: string[] = [];
  const bans: string[] = [];
  for (const row of rows) {
    if (row.rule === 'pin') pins.push(row.component_type);
    else bans.push(row.component_type);
  }
  return { pins, bans };
}
