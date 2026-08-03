import type { FamilyLanguageState } from '@hivekitchen/types';

// Test-only in-memory stand-in for the `family_language_terms` table and the two
// SECURITY DEFINER functions defined in
// supabase/migrations/20261036000000_create_family_language_terms.sql.
//
// SCOPE OF WHAT THIS PROVES: it models the row storage and the *observable
// semantics* of both RPCs, so the repository, service and route layers are
// exercised against realistic behaviour instead of a rubber stamp. It does NOT
// execute the SQL — this repo has no Postgres test harness, so the function
// bodies themselves (and their SELECT … FOR UPDATE row locking) are verified by
// review, not by a runner. Same coverage gap as replace_child_extra_rules
// (15-s5). Each rpc() call here resolves without interleaving, mirroring the
// single transaction each real function runs in.
//
// Kept out of a *.test.ts file so both family-language.repository.test.ts and
// family-language.routes.test.ts share one definition — two divergent copies of
// the ratchet semantics would be worse than the gap above.

export interface TermRow {
  household_id: string;
  term: string;
  maps_to: string;
  usage_count: number;
  state: FamilyLanguageState;
  first_seen_at: string;
  ratified_at: string | null;
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface DetectedInput {
  term: string;
  maps_to: string;
  occurrences: number;
}

export interface FamilyLanguageDouble {
  client: unknown;
  rows: () => TermRow[];
  calls: RpcCall[];
}

// Mirrors `RETURNING *` / to_jsonb(row): whole rows, id and household_id
// included. The repository is responsible for projecting down to the wire shape.
function fullRow(row: TermRow): Record<string, unknown> {
  return { id: `row-${row.household_id}-${row.term}`, ...row };
}

function project(row: TermRow, columns: string): Record<string, unknown> {
  const wanted = columns.split(',').map((c) => c.trim());
  const source = fullRow(row);
  const out: Record<string, unknown> = {};
  for (const column of wanted) out[column] = source[column];
  return out;
}

export function buildFamilyLanguageDouble(initial: TermRow[] = []): FamilyLanguageDouble {
  const table: TermRow[] = initial.map((r) => ({ ...r }));
  const calls: RpcCall[] = [];

  // record_family_language_usage: per-term insert-or-bump, returning the rows
  // that crossed the ratification threshold on this call.
  function recordUsage(args: Record<string, unknown>): Record<string, unknown>[] {
    const householdId = args.p_household_id as string;
    const detected = (args.p_detected ?? []) as DetectedInput[];
    const threshold = args.p_threshold as number;
    const crossed: Record<string, unknown>[] = [];
    // Real Postgres stamps every row created in this call with the SAME
    // transaction timestamp — `now()` is fixed per-transaction, not per-row.
    // One timestamp captured here (not inside the loop) mirrors that.
    const callTimestamp = new Date().toISOString();

    for (const d of detected) {
      if (typeof d.term !== 'string' || typeof d.maps_to !== 'string') continue;
      const occurrences = d.occurrences ?? 0;
      const existing = table.find((r) => r.household_id === householdId && r.term === d.term);

      if (existing === undefined) {
        const created: TermRow = {
          household_id: householdId,
          term: d.term,
          maps_to: d.maps_to,
          usage_count: occurrences,
          state: 'candidate',
          first_seen_at: callTimestamp,
          ratified_at: null,
        };
        table.push(created);
        if (occurrences >= threshold) crossed.push(fullRow(created));
        continue;
      }

      const prev = existing.usage_count;
      existing.usage_count = prev + occurrences;
      if (existing.state === 'candidate' && prev < threshold && existing.usage_count >= threshold) {
        crossed.push(fullRow(existing));
      }
    }

    return crossed;
  }

  // ratify_family_language_term: forward-only ratchet. `active` is terminal —
  // no action moves a term off it.
  function ratify(args: Record<string, unknown>): Record<string, unknown>[] {
    const householdId = args.p_household_id as string;
    const term = args.p_term as string;
    const action = args.p_action as string;

    const row = table.find((r) => r.household_id === householdId && r.term === term);
    if (row === undefined) return [];

    let transitionedFrom: FamilyLanguageState | null = null;
    if (action === 'opt_in' && row.state === 'candidate') {
      transitionedFrom = row.state;
      row.state = 'active';
      row.ratified_at = new Date().toISOString();
    } else if (action === 'forget' && row.state === 'candidate') {
      transitionedFrom = row.state;
      row.state = 'forgotten';
    }

    return [
      {
        term: row.term,
        maps_to: row.maps_to,
        usage_count: row.usage_count,
        state: row.state,
        first_seen_at: row.first_seen_at,
        ratified_at: row.ratified_at,
        transitioned_from: transitionedFrom,
      },
    ];
  }

  const client = {
    from(table_: string) {
      if (table_ !== 'family_language_terms') throw new Error(`unexpected table: ${table_}`);
      let columns = '*';
      let householdId: string | null = null;
      const orderBy: string[] = [];

      const builder = {
        select(cols: string) {
          columns = cols;
          return builder;
        },
        eq(column: string, value: string) {
          if (column !== 'household_id') throw new Error(`unexpected filter: ${column}`);
          householdId = value;
          return builder;
        },
        order(column: string) {
          orderBy.push(column);
          return builder;
        },
        then(resolve: (v: unknown) => unknown) {
          const matched = table.filter((r) => householdId === null || r.household_id === householdId);
          const sorted = [...matched].sort((a, b) => {
            for (const column of orderBy) {
              const left = String(a[column as keyof TermRow] ?? '');
              const right = String(b[column as keyof TermRow] ?? '');
              if (left !== right) return left < right ? -1 : 1;
            }
            return 0;
          });
          return resolve({ data: sorted.map((r) => project(r, columns)), error: null });
        },
      };
      return builder;
    },

    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (fn === 'record_family_language_usage') {
        return { data: recordUsage(args), error: null };
      }
      if (fn === 'ratify_family_language_term') {
        return { data: ratify(args), error: null };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    },
  };

  return { client, rows: () => table, calls };
}
