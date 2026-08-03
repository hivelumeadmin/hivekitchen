-- Story 15-s5 (Canonical Data Model v2 §4.2, §5 row 6, §8 step 3, §10) —
-- Drop the JSONB extra-rules column and the RPC that existed only to make it
-- safe to append to.
--
-- `children.extra_rules` (20260800000000) held {pins, bans} string arrays.
-- 20261035000400 replaced it with `child_extra_rules` rows. This migration
-- removes the duplicate representation.
--
-- `append_extra_ban(uuid, uuid, text)` (20260811000000) existed solely to make
-- a read-then-append on a JSONB array atomic under concurrent writers. Row
-- storage makes it unnecessary: concurrent appends of *different* component
-- types no longer touch the same row at all, and a repeat of the *same* type is
-- caught by child_extra_rules_child_rule_type_idx. ExtraRulesRepository now
-- inserts directly. It is dropped rather than left orphaned — an unused
-- SECURITY DEFINER function granted to service_role is dead attack surface.
--
-- Runs AFTER `apps/api/scripts/backfill-child-extra-rules.ts` has executed
-- against this database and its parity gate has passed (every pin/ban entry in
-- the JSONB carries a matching child_extra_rules row, and no row is orphaned).
-- The script ABORTs non-zero on mismatch, so applying this migration before the
-- gate passes is a data-loss event by design. The script also cannot run
-- afterwards: `verifyParity` reads `children.extra_rules`, so once the column is
-- gone the cutover is no longer verifiable.
--
-- Ordering: migrations apply in filename order, so …000400 (create) always
-- precedes …000500 (drop), and both land after the still-unpushed
-- 20261035000000/…000100/…000200/…000300 from 15-s1 through 15-s4.
--
-- Behaviour is unchanged by this drop. Every consumer — planner context,
-- snack rotation, Extra-slot coverage gating, the Kitchen Map composer, the
-- REST routes — reads through ExtraRulesRepository or KitchenMapRepository,
-- both of which now source the same {pins, bans} shape from rows. The wire
-- contract (packages/contracts/src/extra-rules.ts) is untouched.
--
-- Pre-beta hard cutover (same stance as 20261008000100 and 20261035000300):
-- rollback data loss is acceptable. The honest rollback path is re-adding the
-- column with its old default and repopulating it by aggregating
-- child_extra_rules back into {pins, bans}.
--
-- Mirrors:
--   - apps/api/src/modules/children/extra-rules.repository.ts
--   - apps/api/src/modules/kitchen-map/kitchen-map.repository.ts (CHILD_COLUMNS)
--   - apps/api/src/modules/plans/extra-removal-signal.service.ts

DROP FUNCTION IF EXISTS append_extra_ban(uuid, uuid, text);

ALTER TABLE children
  DROP COLUMN IF EXISTS extra_rules;
