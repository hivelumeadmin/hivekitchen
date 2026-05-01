-- Story 2.14: server-side feature flag for the week-1–2 ghost-timestamp
-- escalation on plan tiles. Defaults to false and is only ever flipped to
-- true by the API after detecting a ≥3 retry burst on the same edit_key
-- within 60 seconds (anxiety leakage signal). The flag is server-written
-- only — never client-writable — and the Plan Tile component (Epic 3) reads
-- it to decide whether to render the "saved just now" pip.
--
-- Architecture §5.6 — DB column at beta is the sole feature-flag mechanism;
-- no GrowthBook, no in-memory flags. Mirrors `households.tier_variant`.
ALTER TABLE households
  ADD COLUMN tile_ghost_timestamp_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN households.tile_ghost_timestamp_enabled IS
  'Server-written anxiety-leakage feature flag (Architecture §5.6). Set to true '
  'when a user retries the same tile edit ≥3 times within 60 s during the first '
  '14 days post-onboarding (POST /v1/households/tile-retry threshold logic). '
  'Never reverts to false. Never client-writable. Read by the Plan Tile component '
  '(Epic 3, Story 3.9) to render a "saved just now" pip after edits.';
