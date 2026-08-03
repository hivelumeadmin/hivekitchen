import {
  LunchRatingSignalPayloadSchema,
  LunchRatingSubjectRefSchema,
} from '@hivekitchen/contracts';
import type { SignalRow } from '@hivekitchen/types';
import type {
  ChildPreferenceInsert,
  ChildPreferencesRepository,
} from './child-preferences.repository.js';

// Story 15-s3 (canonical data model v2 §4.9) — child_preferences is a
// PROJECTION over the append-only signals log. Nothing writes the table except
// this module, applying from a landed `lunch_rating` SignalRow.
//
// The projection is forward-apply-only: it never replays history at runtime, so
// a flavor-journey reset (7-S7 deleteByChild) stays effective even though the
// signals behind those rows survive. The backfill/parity script is the only
// full rebuild, and it is a cutover-time tool.
//
// child_preferences.source is a DIFFERENT vocabulary from signals.source: the
// live writer defaults to 'layer1_emoji' (child-preferences.repository.ts) and
// parity requires reproducing that, not copying 'lunch_link' | 'import' across.
const PROJECTION_SOURCE = 'layer1_emoji';

interface ProjectionLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

type SkipReason = 'child_id' | 'subject_ref' | 'payload';

function toChildPreferenceInsert(row: SignalRow): ChildPreferenceInsert | SkipReason {
  if (row.child_id === null) return 'child_id';

  const ref = LunchRatingSubjectRefSchema.safeParse(row.subject_ref);
  if (!ref.success) return 'subject_ref';

  const payload = LunchRatingSignalPayloadSchema.safeParse(row.payload);
  if (!payload.success) return 'payload';

  return {
    household_id: row.household_id,
    child_id: row.child_id,
    recipe_id: ref.data.recipe_id,
    slot_kind: ref.data.slot_kind,
    signal_type: payload.data.rating,
    // The rated day lives ONLY in payload.date — occurred_at is submission
    // wall-clock and can fall on the following day.
    signal_date: payload.data.date,
    source: PROJECTION_SOURCE,
  };
}

// Later of two signals for the same dedup key. Mirrors the upsert's
// last-write-wins: occurred_at, then created_at, then id — so the collapse is
// deterministic regardless of input order.
function isLater(candidate: SignalRow, incumbent: SignalRow): boolean {
  if (candidate.occurred_at !== incumbent.occurred_at) {
    return candidate.occurred_at > incumbent.occurred_at;
  }
  if (candidate.created_at !== incumbent.created_at) {
    return candidate.created_at > incumbent.created_at;
  }
  return candidate.id > incumbent.id;
}

// Collapses lunch_rating signals to the child_preferences rows they imply: one
// per (child_id, recipe_id, slot_kind, payload.date), reproducing the
// child_preferences_dedup upsert semantics (N appended re-ratings → 1 row).
// Unprojectable rows are skipped and counted, never thrown — a poisoned row in
// an immutable log must not be able to block a rebuild.
export function projectLunchRatings(
  rows: SignalRow[],
  logger?: ProjectionLogger,
): ChildPreferenceInsert[] {
  const winners = new Map<string, { signal: SignalRow; insert: ChildPreferenceInsert }>();
  const reasons: Partial<Record<SkipReason, number>> = {};
  let skipped = 0;

  for (const row of rows) {
    const projected = toChildPreferenceInsert(row);
    if (typeof projected === 'string') {
      skipped += 1;
      reasons[projected] = (reasons[projected] ?? 0) + 1;
      continue;
    }

    const key = `${projected.child_id}|${projected.recipe_id}|${projected.slot_kind}|${projected.signal_date}`;
    const incumbent = winners.get(key);
    if (incumbent === undefined || isLater(row, incumbent.signal)) {
      winners.set(key, { signal: row, insert: projected });
    }
  }

  if (skipped > 0) {
    logger?.warn(
      { skipped, reasons, scanned: rows.length },
      'child_preferences projection skipped unprojectable lunch_rating signals',
    );
  }

  return [...winners.values()].map((w) => w.insert);
}

// Applies ONE landed signal to the projection. Mapping failures warn and write
// nothing; an upsert failure propagates so the calling seam can warn-and-
// continue per slot (15-s2 fire-and-forget doctrine, downstream of the log).
export async function applyLunchRatingSignal(
  repository: Pick<ChildPreferencesRepository, 'upsertSignal'>,
  row: SignalRow,
  logger: ProjectionLogger,
): Promise<void> {
  const projected = toChildPreferenceInsert(row);
  if (typeof projected === 'string') {
    logger.warn(
      { signal_id: row.id, reason: projected },
      'child_preferences projection skipped a landed signal — nothing written',
    );
    return;
  }
  await repository.upsertSignal(projected);
}
