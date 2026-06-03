-- Story 4-S11: Layer 2 signal → planner feedback loop.
--
-- child_preferences captures per-(child, recipe, slot_kind, day) emoji-rating
-- signals derived from lunch_link_sessions.rating (Layer 1). The planner reads
-- the aggregated form via the child_signal tool to bias next week's plan toward
-- recipes a child enjoys (FR124/FR125/FR126).
--
-- PII discipline: recipe_id / slot_kind / signal_type are not PII; child_id is a
-- UUID. Child names are NEVER stored here — they are joined at tool-output time
-- only for agent readability.
--
-- AC1 prescribed the filename 20261011000000_child_preferences_signal.sql; that
-- timestamp was taken by 20261011000000_brief_state_payload.sql (3-DM-D1) after
-- this story was authored, so this migration uses the next free slot.

CREATE TABLE child_preferences (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID        NOT NULL REFERENCES households(id)  ON DELETE CASCADE,
  child_id     UUID        NOT NULL REFERENCES children(id)    ON DELETE CASCADE,
  recipe_id    UUID        NOT NULL REFERENCES recipes(id)     ON DELETE CASCADE,
  slot_kind    TEXT        NOT NULL CHECK (slot_kind IN ('main','snack','extra')),
  signal_type  TEXT        NOT NULL CHECK (signal_type IN ('loved','ok','not-really')),
  signal_date  DATE        NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'layer1_emoji',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup key: one signal per (child, recipe, slot_kind, day). Re-rating the same
-- day overwrites via ON CONFLICT DO UPDATE (latest signal wins). slot_kind is
-- part of the key so the same recipe in two slots keeps independent signals
-- (FR124).
CREATE UNIQUE INDEX child_preferences_dedup
  ON child_preferences(child_id, recipe_id, slot_kind, signal_date);
CREATE INDEX child_preferences_household_idx ON child_preferences(household_id);
CREATE INDEX child_preferences_child_date_idx ON child_preferences(child_id, signal_date DESC);

ALTER TABLE child_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY child_preferences_household_rw ON child_preferences
  FOR ALL
  USING (household_id = (SELECT current_household_id FROM users WHERE id = auth.uid()));
