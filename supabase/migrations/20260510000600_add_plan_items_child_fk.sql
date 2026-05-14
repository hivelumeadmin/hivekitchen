-- Adds the deferred FK constraint plan_items.child_id → children(id).
--
-- The plan_items table was created in 20260502110000_create_plans_and_plan_items.sql,
-- but children doesn't exist until 20260510000000_create_children_table.sql. To keep
-- a clean-slate migration apply working, the FK is split out of the original
-- plan_items DDL and added here, after children is in place.
--
-- ON DELETE CASCADE preserves the original intent: deleting a child wipes their
-- plan_items. Mirrors the inline REFERENCES clause that used to live on the
-- column declaration.
--
-- Idempotency: a future re-apply (e.g. a hypothetical migration rollback +
-- re-push) is gated by IF NOT EXISTS so this migration is safe to re-run
-- against an already-patched DB. Postgres does not support IF NOT EXISTS on
-- ADD CONSTRAINT directly; the DO block + catalog check is the standard
-- workaround.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plan_items_child_id_fkey'
      AND conrelid = 'plan_items'::regclass
  ) THEN
    ALTER TABLE plan_items
      ADD CONSTRAINT plan_items_child_id_fkey
      FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE;
  END IF;
END $$;
