-- Slice A0 — Kitchen Map cache invalidation via version-key on households.
--
-- The Kitchen Map is a household-state projection composed in application code
-- (apps/api/src/modules/kitchen-map/) and cached in Redis under a key
-- parameterized by household_id + this version column. Triggers on satellite
-- tables bump the version atomically with each write, so the next read computes
-- a new cache key and naturally falls back to source.
--
-- Pattern precedent: brief_state (20260502120000) — application-maintained
-- projection. We extend it with trigger-driven invalidation because the
-- Kitchen Map is read-hot (every agent invocation) and write-cold (onboarding +
-- occasional updates). The actual map shape is composed and Zod-validated in
-- application code; this migration only provides the invalidation mechanism.
--
-- Tables that contribute to the Kitchen Map (and therefore have triggers here):
--   - children                        (direct household_id; extra_rules JSONB lives here)
--   - cultural_priors                 (direct household_id)
--   - memory_nodes                    (direct household_id)
--   - extra_library                   (direct household_id)
--   - allergy_rules                   (direct household_id; nullable for FALCPA rows)
--   - school_policies                 (child_id only — resolved via children)
--   - users                           (current_household_id; column-aware)
--
-- Tables intentionally NOT triggered:
--   - households (self-trigger would recurse; small number of writers of
--                 tier/tier_variant/timezone call bump_kitchen_map_version_for_household
--                 explicitly via RPC. See KitchenMapService.bumpVersion.)
--   - pantry / brief_state / plans   (dynamic; not part of the Kitchen Map projection)
--
-- Rollback:
--   DROP TRIGGER IF EXISTS users_bump_kitchen_map ON users;
--   DROP TRIGGER IF EXISTS school_policies_bump_kitchen_map ON school_policies;
--   DROP TRIGGER IF EXISTS allergy_rules_bump_kitchen_map ON allergy_rules;
--   DROP TRIGGER IF EXISTS extra_library_bump_kitchen_map ON extra_library;
--   DROP TRIGGER IF EXISTS memory_nodes_bump_kitchen_map ON memory_nodes;
--   DROP TRIGGER IF EXISTS cultural_priors_bump_kitchen_map ON cultural_priors;
--   DROP TRIGGER IF EXISTS children_bump_kitchen_map ON children;
--   DROP FUNCTION IF EXISTS bump_kitchen_map_from_user();
--   DROP FUNCTION IF EXISTS bump_kitchen_map_from_child();
--   DROP FUNCTION IF EXISTS bump_kitchen_map_version();
--   DROP FUNCTION IF EXISTS bump_kitchen_map_version_for_household(uuid);
--   ALTER TABLE households DROP COLUMN IF EXISTS kitchen_map_version;

-- ---------------------------------------------------------------------------
-- 1. Version column
-- ---------------------------------------------------------------------------

ALTER TABLE households
  ADD COLUMN kitchen_map_version BIGINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN households.kitchen_map_version IS
  'Slice A0 — monotonic version bumped by triggers on satellite tables. '
  'Used by KitchenMapService as the cache-key suffix in Redis so any source '
  'write atomically invalidates the cached projection. Never decremented. '
  'For application-layer bumps (tier/tier_variant/timezone changes that no '
  'trigger covers) call bump_kitchen_map_version_for_household(uuid).';

-- ---------------------------------------------------------------------------
-- 2. Trigger functions
-- ---------------------------------------------------------------------------

-- Generic bump function — for tables that carry a direct household_id column.
-- Resolves the target household from NEW (INSERT/UPDATE) or OLD (DELETE) via
-- jsonb extraction so a single function covers every such table without
-- needing a per-table variant.
--
-- SECURITY DEFINER + locked search_path matches the project's idempotent
-- functions (e.g. create_household_and_user). The trigger needs to UPDATE
-- the households row even if the caller's role lacks direct UPDATE rights
-- on households (rare in practice — all writes go through service_role —
-- but consistent with the project's defense-in-depth pattern).
CREATE OR REPLACE FUNCTION bump_kitchen_map_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_household_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_household_id := (to_jsonb(OLD)->>'household_id')::uuid;
  ELSE
    target_household_id := (to_jsonb(NEW)->>'household_id')::uuid;
  END IF;

  -- Nullable household_id (e.g. allergy_rules FALCPA rows) → no-op.
  IF target_household_id IS NOT NULL THEN
    UPDATE households
      SET kitchen_map_version = kitchen_map_version + 1
      WHERE id = target_household_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- school_policies-specific: the table carries child_id but not household_id,
-- so we resolve the parent household via the children table.
CREATE OR REPLACE FUNCTION bump_kitchen_map_from_child()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  source_child_id     uuid;
  target_household_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    source_child_id := OLD.child_id;
  ELSE
    source_child_id := NEW.child_id;
  END IF;

  IF source_child_id IS NOT NULL THEN
    SELECT household_id INTO target_household_id
      FROM children WHERE id = source_child_id;

    IF target_household_id IS NOT NULL THEN
      UPDATE households
        SET kitchen_map_version = kitchen_map_version + 1
        WHERE id = target_household_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- users-specific: column-aware. Skips bumping when the changed columns
-- don't affect the Kitchen Map (e.g. last_login_at, notification_prefs).
-- Handles the household-transfer case by bumping both OLD and NEW
-- current_household_id.
CREATE OR REPLACE FUNCTION bump_kitchen_map_from_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- INSERT: always bump the new household (the user joining is a map change).
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_household_id IS NOT NULL THEN
      UPDATE households
        SET kitchen_map_version = kitchen_map_version + 1
        WHERE id = NEW.current_household_id;
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE: bump the household the user belonged to.
  IF TG_OP = 'DELETE' THEN
    IF OLD.current_household_id IS NOT NULL THEN
      UPDATE households
        SET kitchen_map_version = kitchen_map_version + 1
        WHERE id = OLD.current_household_id;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: only bump if a Kitchen Map-relevant column changed.
  -- (display_name, role, current_household_id, cultural_language)
  IF OLD.display_name         IS DISTINCT FROM NEW.display_name
     OR OLD.role              IS DISTINCT FROM NEW.role
     OR OLD.cultural_language IS DISTINCT FROM NEW.cultural_language
     OR OLD.current_household_id IS DISTINCT FROM NEW.current_household_id
  THEN
    IF NEW.current_household_id IS NOT NULL THEN
      UPDATE households
        SET kitchen_map_version = kitchen_map_version + 1
        WHERE id = NEW.current_household_id;
    END IF;
    -- Transfer case: also bump the household the user left.
    IF OLD.current_household_id IS NOT NULL
       AND OLD.current_household_id IS DISTINCT FROM NEW.current_household_id
    THEN
      UPDATE households
        SET kitchen_map_version = kitchen_map_version + 1
        WHERE id = OLD.current_household_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Application-layer RPC for household-level column writers
-- ---------------------------------------------------------------------------

-- Called by KitchenMapService.bumpVersion(householdId) from application code
-- when columns of `households` itself change (tier, tier_variant, timezone).
-- We do not self-trigger on households to avoid recursive trigger firing
-- when this very column is updated.
CREATE OR REPLACE FUNCTION bump_kitchen_map_version_for_household(p_household_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE households
    SET kitchen_map_version = kitchen_map_version + 1
    WHERE id = p_household_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION bump_kitchen_map_version_for_household(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION bump_kitchen_map_version_for_household(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Triggers — one per source table contributing to the Kitchen Map
-- ---------------------------------------------------------------------------

-- AFTER triggers: the source-row write commits first; the version bump
-- follows in the same transaction. If the bump somehow fails, the source
-- write still rolls back as one unit (Postgres trigger transaction
-- semantics) — we prefer that over silently shipping a stale cache key.

CREATE TRIGGER children_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON children
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();

CREATE TRIGGER cultural_priors_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON cultural_priors
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();

CREATE TRIGGER memory_nodes_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON memory_nodes
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();

CREATE TRIGGER extra_library_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON extra_library
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();

CREATE TRIGGER allergy_rules_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON allergy_rules
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_version();

CREATE TRIGGER school_policies_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON school_policies
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_from_child();

CREATE TRIGGER users_bump_kitchen_map
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW
  EXECUTE FUNCTION bump_kitchen_map_from_user();
