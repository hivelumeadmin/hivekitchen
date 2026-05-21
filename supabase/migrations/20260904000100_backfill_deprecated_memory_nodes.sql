-- Slice 2.5-s2 — backfill deprecated memory_node node_types into the
-- structured signal tables (where mappable) and soft-forget the source
-- rows. Pure SQL; idempotent. Pairs with 20260904000300 (enum narrowing).
--
-- Strategy:
--   * 'cultural_rhythm' rows: attempt to map facet → cultural_priors.key.
--     The cultural_priors.key CHECK constraint still restricts keys to
--     ('halal','kosher','hindu_vegetarian','south_asian','east_african',
--     'caribbean') (a follow-up migration will retrofit it to FK against
--     cultural_tags). Rows whose derived key falls outside that set are
--     not insertable into cultural_priors — they're soft-forgotten with
--     reason='key_not_in_cultural_priors_check_set' instead.
--   * 'preference', 'allergy', 'school_policy' rows: no backfill target
--     (prose is too unstructured to parse without an LLM); soft-forget
--     only. The structured allergen data lives on children.declared_
--     allergens and is migrated to child_allergens by the app-layer
--     script in the same slice.
--
-- Idempotency:
--   * Section A (cultural_priors INSERT): ON CONFLICT (household_id, key)
--     DO NOTHING.
--   * Section B (memory_provenance INSERT): bounded by a NOT EXISTS check
--     that scans for an existing 2.5-s2 provenance row on the same node.
--   * Section C (soft_forget_at UPDATE): WHERE soft_forget_at IS NULL.
--   * Section D (memory_provenance INSERT for soft-forget): same NOT
--     EXISTS guard as Section B.
--
-- Rollback: no automated rollback. Soft-forgotten rows can be restored
-- manually by zeroing soft_forget_at where the related provenance row
-- has source_ref->>'migration' = '2.5-s2'. Backfilled cultural_priors
-- rows can be deleted by joining on the same source_ref.

-- ---------------------------------------------------------------------------
-- Section A — backfill 'cultural_rhythm' → cultural_priors
-- ---------------------------------------------------------------------------
-- Derive key by kebab-casing facet (lowercase, replace non-alnum-_ with
-- single hyphens, trim leading/trailing hyphens, cap at 64 chars).
-- Pre-filter to the cultural_priors.key CHECK set so the INSERT cannot
-- fail mid-migration.

WITH eligible AS (
  SELECT
    mn.id            AS memory_node_id,
    mn.household_id  AS household_id,
    mn.facet         AS facet,
    mn.prose_text    AS prose_text,
    SUBSTRING(
      TRIM(BOTH '-' FROM
        REGEXP_REPLACE(LOWER(TRIM(mn.facet)), '[^a-z0-9_]+', '-', 'g')
      )
      FROM 1 FOR 64
    ) AS derived_key
  FROM memory_nodes mn
  WHERE mn.node_type = 'cultural_rhythm'
    AND mn.hard_forgotten = false
)
INSERT INTO cultural_priors (
  household_id,
  key,
  label,
  state,
  tier,
  presence,
  confidence,
  enforcement
)
SELECT
  e.household_id,
  e.derived_key,
  SUBSTRING(e.prose_text FROM 1 FOR 128),
  'suggested',
  'L3',
  50,
  50,
  'just_for_context'
FROM eligible e
WHERE e.derived_key IN (
  'halal','kosher','hindu_vegetarian','south_asian','east_african','caribbean'
)
ON CONFLICT (household_id, key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Section B — write memory_provenance for successfully backfilled 'cultural_rhythm'
-- rows (those whose derived key IS in the CHECK set and had a row inserted into
-- cultural_priors). Rows outside the CHECK set are handled by Section B2 below.
-- ---------------------------------------------------------------------------

WITH derived AS (
  SELECT
    mn.id            AS memory_node_id,
    SUBSTRING(
      TRIM(BOTH '-' FROM
        REGEXP_REPLACE(LOWER(TRIM(mn.facet)), '[^a-z0-9_]+', '-', 'g')
      )
      FROM 1 FOR 64
    ) AS derived_key
  FROM memory_nodes mn
  WHERE mn.node_type = 'cultural_rhythm'
    AND mn.hard_forgotten = false
)
INSERT INTO memory_provenance (
  memory_node_id,
  source_type,
  source_ref,
  captured_at,
  confidence
)
SELECT
  d.memory_node_id,
  'import',
  jsonb_build_object(
    'migration', '2.5-s2',
    'target_table', 'cultural_priors',
    'target_key', d.derived_key
  ),
  now(),
  0.50
FROM derived d
WHERE d.derived_key IN (
  'halal','kosher','hindu_vegetarian','south_asian','east_african','caribbean'
)
AND NOT EXISTS (
  SELECT 1 FROM memory_provenance mp
  WHERE mp.memory_node_id = d.memory_node_id
    AND mp.source_ref->>'migration' = '2.5-s2'
);

-- ---------------------------------------------------------------------------
-- Section B2 — write memory_provenance for 'cultural_rhythm' rows whose derived
-- key was NOT in the CHECK set (soft-forgotten but not backfilled).
-- ---------------------------------------------------------------------------

WITH derived AS (
  SELECT
    mn.id            AS memory_node_id,
    SUBSTRING(
      TRIM(BOTH '-' FROM
        REGEXP_REPLACE(LOWER(TRIM(mn.facet)), '[^a-z0-9_]+', '-', 'g')
      )
      FROM 1 FOR 64
    ) AS derived_key
  FROM memory_nodes mn
  WHERE mn.node_type = 'cultural_rhythm'
    AND mn.hard_forgotten = false
)
INSERT INTO memory_provenance (
  memory_node_id,
  source_type,
  source_ref,
  captured_at,
  confidence
)
SELECT
  d.memory_node_id,
  'import',
  jsonb_build_object(
    'migration', '2.5-s2',
    'action', 'soft_forget_no_backfill_target',
    'reason', 'cultural_rhythm_key_not_in_check_set',
    'derived_key', d.derived_key
  ),
  now(),
  0.50
FROM derived d
WHERE d.derived_key NOT IN (
  'halal','kosher','hindu_vegetarian','south_asian','east_african','caribbean'
)
AND NOT EXISTS (
  SELECT 1 FROM memory_provenance mp
  WHERE mp.memory_node_id = d.memory_node_id
    AND mp.source_ref->>'migration' = '2.5-s2'
);

-- ---------------------------------------------------------------------------
-- Section C — soft-forget all deprecated memory_node rows
-- ---------------------------------------------------------------------------
-- Covers cultural_rhythm (already backfilled in Section A), plus the
-- three free-text-only types that have no structured backfill target.

UPDATE memory_nodes
SET soft_forget_at = now()
WHERE node_type IN ('preference','cultural_rhythm','allergy','school_policy')
  AND soft_forget_at IS NULL
  AND hard_forgotten = false;

-- ---------------------------------------------------------------------------
-- Section D — write memory_provenance for soft-forgotten non-cultural_rhythm rows
-- ---------------------------------------------------------------------------
-- 'preference', 'allergy', 'school_policy' rows have no structured target —
-- the provenance captures the soft-forget reason.

INSERT INTO memory_provenance (
  memory_node_id,
  source_type,
  source_ref,
  captured_at,
  confidence
)
SELECT
  mn.id,
  'import',
  jsonb_build_object(
    'migration', '2.5-s2',
    'action', 'soft_forget_no_backfill_target',
    'reason', mn.node_type::text || '_prose_unstructured'
  ),
  now(),
  0.50
FROM memory_nodes mn
WHERE mn.node_type IN ('preference','allergy','school_policy')
  AND mn.hard_forgotten = false
  AND NOT EXISTS (
    SELECT 1 FROM memory_provenance mp
    WHERE mp.memory_node_id = mn.id
      AND mp.source_ref->>'migration' = '2.5-s2'
  );
