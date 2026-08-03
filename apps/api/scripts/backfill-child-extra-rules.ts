#!/usr/bin/env tsx
/**
 * Story 15-s5 — cutover backfill + parity gate for retiring
 * `children.extra_rules` (canonical data model v2 §4.2, §5 row 6, §8 step 3).
 *
 * The JSONB `{pins, bans}` blob is replaced by one `child_extra_rules` row per
 * entry. This script copies every surviving entry into a row before the drop
 * migration removes the column.
 *
 * Steps:
 *   1. Backfill — every `pins[i]` becomes (child_id, 'pin', pins[i]) and every
 *      `bans[i]` becomes (child_id, 'ban', bans[i]). Zero-length labels are
 *      nothing to migrate and are skipped (counted + warned). Labels exceeding
 *      the 50-char CHECK on `child_extra_rules.component_type` are skipped
 *      (counted + warned) BEFORE the batch is built, so one bad row can never
 *      abort a whole page's insert — the exact bug 15-s4's review caught.
 *      Idempotent: the upsert uses the (child_id, rule, component_type) unique
 *      index with ON CONFLICT DO NOTHING, so a re-run never double-inserts and
 *      never clobbers a row a human has since edited through PATCH.
 *   2. Parity gate — the set of (child_id, rule, component_type) triples
 *      derivable from the JSONB must equal the set of `child_extra_rules` rows,
 *      in BOTH directions. Any difference exits non-zero. There is no
 *      skip-on-error escape hatch: an unverifiable database is a failed cutover.
 *
 * Casing is preserved verbatim. `ExtraRulesSchema`'s uniqueness refine is
 * case-SENSITIVE, so `pins: ['Fruit', 'fruit']` is a legal payload and both
 * entries must survive as distinct rows.
 *
 * ⚠️ RUN BEFORE the drop migration (20261035000500_drop_extra_rules_and_ban_fn),
 * never after — `verifyParity` reads `children.extra_rules` and cannot run once
 * the column is gone. The drop must not be applied until this gate has passed
 * against the target database.
 *
 * An `orphan_rule_row` mismatch (a row with no surviving JSONB entry) fails the
 * gate deliberately. It is not data loss, but it means the two representations
 * diverged after a prior run — a human should look before the column disappears.
 *
 * Invocation:
 *   pnpm --filter @hivekitchen/api exec tsx scripts/backfill-child-extra-rules.ts
 *
 * Environment:
 *   SUPABASE_URL              — required
 *   SUPABASE_SERVICE_ROLE_KEY — required (bypasses RLS)
 *
 * No KEK is needed: component-type labels are plaintext, same as
 * `school_policies.policy_description`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface ScriptDeps {
  client: SupabaseClient;
  pageSize?: number;
  logger?: { warn: (obj: Record<string, unknown>, msg: string) => void };
}

export interface BackfillSummary {
  children_scanned: number;
  skipped_empty: number;
  skipped_too_long: number;
  skipped_duplicate: number;
  rules_inserted: number;
  skipped_existing: number;
}

export type RuleKind = 'pin' | 'ban';
export type MismatchReason = 'missing_rule_row' | 'orphan_rule_row';

// Identity + rule kind only — the component_type label itself is never printed.
export interface ParityMismatch {
  child_id: string;
  rule: RuleKind;
  reason: MismatchReason;
}

export interface ParityResult {
  ok: boolean;
  jsonb_entries: number;
  rule_rows: number;
  matched: number;
  mismatches: ParityMismatch[];
}

interface ChildRulesRow {
  id: string;
  extra_rules: unknown;
}

interface ExtraRuleRow {
  child_id: string;
  rule: RuleKind;
  component_type: string;
}

const DEFAULT_PAGE_SIZE = 500;
const MAX_REPORTED_MISMATCHES = 50;
// child_extra_rules.component_type CHECK (char_length BETWEEN 1 AND 50). The
// contract layer caps entries at 50 too, so this should be a no-op path — but
// the backfill must not trust that every historical row went through the
// validated PATCH route.
const MAX_COMPONENT_TYPE_LENGTH = 50;

// Every paged scan orders by a stable key: repeated offset/limit calls without
// an ORDER BY can reshuffle tied rows between pages and silently skip records.
async function loadChildren(deps: ScriptDeps): Promise<ChildRulesRow[]> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const rows: ChildRulesRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await deps.client
      .from('children')
      .select('id, extra_rules')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as ChildRulesRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function loadRuleRows(deps: ScriptDeps): Promise<ExtraRuleRow[]> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const rows: ExtraRuleRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await deps.client
      .from('child_extra_rules')
      .select('child_id, rule, component_type')
      .order('child_id', { ascending: true })
      .order('rule', { ascending: true })
      .order('component_type', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as ExtraRuleRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

// Tolerant decode of the JSONB column. PostgREST returns it pre-parsed, but a
// raw string, a null, or a rogue shape must not abort the cutover — the entries
// we can read are still worth migrating.
function readEntries(raw: unknown): { pins: string[]; bans: string[] } {
  let parsed: unknown = raw ?? {};
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { pins: [], bans: [] };
    }
  }
  const obj: { pins?: unknown; bans?: unknown } =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { pins?: unknown; bans?: unknown })
      : {};
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : [];
  return { pins: strings(obj.pins), bans: strings(obj.bans) };
}

const key = (r: ExtraRuleRow): string => `${r.child_id} ${r.rule} ${r.component_type}`;

// Every (child, rule, label) triple the JSONB says should exist as a row.
// Zero-length labels are excluded: they cannot satisfy the char_length CHECK
// and there is nothing to migrate. Over-length labels ARE included, so the
// parity gate fails on them and a human looks before the column disappears.
function expectedTriples(children: ChildRulesRow[]): {
  triples: ExtraRuleRow[];
  skipped_empty: number;
} {
  const triples: ExtraRuleRow[] = [];
  let skipped_empty = 0;
  const seen = new Set<string>();
  for (const row of children) {
    const { pins, bans } = readEntries(row.extra_rules);
    for (const [rule, labels] of [
      ['pin', pins],
      ['ban', bans],
    ] as const) {
      for (const label of labels) {
        if (label.length === 0) {
          skipped_empty += 1;
          continue;
        }
        const triple: ExtraRuleRow = { child_id: row.id, rule, component_type: label };
        const k = key(triple);
        if (seen.has(k)) continue;
        seen.add(k);
        triples.push(triple);
      }
    }
  }
  return { triples, skipped_empty };
}

export async function runBackfill(deps: ScriptDeps): Promise<BackfillSummary> {
  const children = await loadChildren(deps);
  const { triples, skipped_empty } = expectedTriples(children);

  // Duplicates collapsed by expectedTriples' `seen` set: the JSONB contract
  // forbids them, but a historical row could still carry one.
  let rawEntryCount = 0;
  for (const row of children) {
    const { pins, bans } = readEntries(row.extra_rules);
    for (const label of [...pins, ...bans]) if (label.length > 0) rawEntryCount += 1;
  }

  const summary: BackfillSummary = {
    children_scanned: children.length,
    skipped_empty,
    skipped_too_long: 0,
    skipped_duplicate: rawEntryCount - triples.length,
    rules_inserted: 0,
    skipped_existing: 0,
  };

  // Length-filter BEFORE building the batch. A single CHECK violation inside a
  // batched upsert aborts the entire statement, so an over-length label would
  // otherwise take every other rule on the page down with it.
  const candidates = triples.filter((t) => {
    if (t.component_type.length > MAX_COMPONENT_TYPE_LENGTH) {
      summary.skipped_too_long += 1;
      return false;
    }
    return true;
  });

  if (summary.skipped_empty > 0) {
    deps.logger?.warn(
      { skipped_empty: summary.skipped_empty, children_scanned: summary.children_scanned },
      'extra_rules backfill skipped empty labels — nothing to migrate',
    );
  }

  if (summary.skipped_too_long > 0) {
    deps.logger?.warn(
      {
        skipped_too_long: summary.skipped_too_long,
        max_length: MAX_COMPONENT_TYPE_LENGTH,
        children_scanned: summary.children_scanned,
      },
      'extra_rules backfill skipped labels exceeding the child_extra_rules.component_type length limit',
    );
  }

  if (summary.skipped_duplicate > 0) {
    deps.logger?.warn(
      { skipped_duplicate: summary.skipped_duplicate },
      'extra_rules backfill collapsed exact duplicate labels within a child',
    );
  }

  if (candidates.length > 0) {
    // ignoreDuplicates → ON CONFLICT DO NOTHING against
    // child_extra_rules_child_rule_type_idx. A row that already exists is left
    // exactly as it is, including any change a human made after an earlier run.
    // The returned rows are the ones actually inserted.
    const { data, error } = await deps.client
      .from('child_extra_rules')
      .upsert(candidates, { onConflict: 'child_id,rule,component_type', ignoreDuplicates: true })
      .select('child_id');
    if (error) throw error;
    summary.rules_inserted = (data ?? []).length;
    summary.skipped_existing = candidates.length - summary.rules_inserted;
  }

  return summary;
}

export async function verifyParity(deps: ScriptDeps): Promise<ParityResult> {
  const { triples } = expectedTriples(await loadChildren(deps));
  const expected = new Map(triples.map((t) => [key(t), t]));

  const actualRows = await loadRuleRows(deps);
  const actual = new Map(actualRows.map((r) => [key(r), r]));

  const result: ParityResult = {
    ok: true,
    jsonb_entries: expected.size,
    rule_rows: actual.size,
    matched: 0,
    mismatches: [],
  };

  for (const [k, t] of expected) {
    if (actual.has(k)) result.matched += 1;
    else result.mismatches.push({ child_id: t.child_id, rule: t.rule, reason: 'missing_rule_row' });
  }
  for (const [k, r] of actual) {
    if (!expected.has(k)) {
      result.mismatches.push({ child_id: r.child_id, rule: r.rule, reason: 'orphan_rule_row' });
    }
  }

  result.ok = result.mismatches.length === 0;
  return result;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || serviceKey === undefined) {
    // eslint-disable-next-line no-console
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    process.exit(1);
  }
  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const logger = {
    warn: (obj: Record<string, unknown>, msg: string) =>
      // eslint-disable-next-line no-console
      console.warn('[backfill-child-extra-rules]', msg, obj),
  };

  const summary = await runBackfill({ client, logger });
  // eslint-disable-next-line no-console
  console.log('[backfill-child-extra-rules] summary:', JSON.stringify(summary, null, 2));

  const parity = await verifyParity({ client, logger });
  // eslint-disable-next-line no-console
  console.log(
    '[backfill-child-extra-rules] parity:',
    JSON.stringify(
      {
        ...parity,
        mismatches: parity.mismatches.slice(0, MAX_REPORTED_MISMATCHES),
        mismatches_total: parity.mismatches.length,
      },
      null,
      2,
    ),
  );

  if (!parity.ok) {
    // eslint-disable-next-line no-console
    console.error(
      '[backfill-child-extra-rules] PARITY GATE FAILED — do NOT apply the drop migration',
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backfill-child-extra-rules] fatal:', err);
    process.exit(1);
  });
}
