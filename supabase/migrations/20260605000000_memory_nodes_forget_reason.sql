-- Story 7-S4: soft-forget a memory sentence.
-- Adds the optional reason text captured when a parent forgets a memory node.
-- soft_forget_at already exists (20260601000000); this column stores the
-- accompanying free-text reason. Nullable — NULL is correct for active nodes.
ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS forget_reason text;
