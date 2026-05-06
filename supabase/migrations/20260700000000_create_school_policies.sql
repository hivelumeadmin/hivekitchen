-- Story 3.16: school_policies table — replaces the free-text school_policy_notes
-- column on children with a normalized rule store. Each row is a single policy
-- rule (e.g. nut_free, no_heating) scoped to a slot via slot_scope. FR112 says
-- a parent can target a constraint at the bag-wide, main, snack, or extra slot.
--
-- The 2.10 migration explicitly deferred this table; school_policy_notes
-- remains on children as free-text and is left untouched here so existing rows
-- and audits continue to read.
--
-- Mirrors:
--   - apps/api/src/modules/children/school-policies.repository.ts
--   - packages/contracts/src/school-policy.ts (SlotScopeSchema, SchoolPolicySchema)

DO $$ BEGIN
  CREATE TYPE slot_scope_enum AS ENUM ('bag_wide', 'main', 'snack', 'extra');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS school_policies (
  id                  uuid            NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  child_id            uuid            NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  policy_type         text            NOT NULL CHECK (char_length(policy_type) BETWEEN 1 AND 100),
  policy_description  text            NULL CHECK (policy_description IS NULL OR char_length(policy_description) <= 500),
  slot_scope          slot_scope_enum NOT NULL DEFAULT 'bag_wide',
  is_active           boolean         NOT NULL DEFAULT true,
  created_at          timestamptz     NOT NULL DEFAULT now(),
  updated_at          timestamptz     NOT NULL DEFAULT now()
);

-- Upsert key for SchoolPoliciesRepository.upsertPolicy(): one row per
-- (child, policy_type). slot_scope and is_active are mutable on conflict.
CREATE UNIQUE INDEX IF NOT EXISTS school_policies_child_policy_type_idx
  ON school_policies (child_id, policy_type);

-- Look up active policies for a child quickly (planner prompt context, GET route).
CREATE INDEX IF NOT EXISTS school_policies_child_id_idx
  ON school_policies (child_id);

CREATE TRIGGER school_policies_set_updated_at
  BEFORE UPDATE ON school_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Match the project pattern: API uses the service-role client which bypasses
-- RLS. Enabling RLS here keeps anon/authed Supabase SDK callers out by default;
-- household scoping is enforced by the API layer via children.household_id.
ALTER TABLE school_policies ENABLE ROW LEVEL SECURITY;
