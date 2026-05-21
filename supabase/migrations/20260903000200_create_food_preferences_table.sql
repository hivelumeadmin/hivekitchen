-- Slice 2.5-s1 — Foundation: food_preferences structured table.
--
-- Per-child OR household-scoped food preferences. `child_id NULL` means
-- household-wide. `item` is open-vocabulary (the agent may emit any free-text
-- food name); valence carries the like/dislike polarity; enforcement carries
-- the strength.
--
-- Encryption: `item` is AES-256-GCM ciphertext under the household DEK.
-- `item_hash` is SHA-256(lower(trim(plaintext))) for idempotency.
--
-- Idempotency: UNIQUE on (household_id, COALESCE(child_id, '00000000-0000-0000-0000-000000000000'::uuid), item_hash)
-- via a partial-index pair so household-wide and per-child preferences for
-- the same item key don't collide. Postgres unique indexes treat NULLs as
-- distinct, which would let duplicate household-wide rows slip through —
-- the COALESCE workaround coerces NULL into a sentinel for indexing purposes.
--
-- Rollback:
--   DROP TABLE IF EXISTS food_preferences;

CREATE TABLE food_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id uuid REFERENCES children(id) ON DELETE CASCADE,
  item text NOT NULL,
  item_hash text NOT NULL,
  valence text NOT NULL CHECK (valence IN ('loves', 'likes', 'neutral', 'dislikes', 'refuses')),
  enforcement enforcement_level NOT NULL DEFAULT 'soft',
  source text NOT NULL CHECK (source IN (
    'onboarding_declared',
    'memory_promoted',
    'rating_signal',
    'parent_edited',
    'backfill_migration'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX food_preferences_scope_hash_uniq
  ON food_preferences (
    household_id,
    COALESCE(child_id, '00000000-0000-0000-0000-000000000000'::uuid),
    item_hash
  );

CREATE INDEX food_preferences_household_idx
  ON food_preferences (household_id);

CREATE INDEX food_preferences_child_idx
  ON food_preferences (child_id)
  WHERE child_id IS NOT NULL;
