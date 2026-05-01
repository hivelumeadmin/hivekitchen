-- Story 2.13: memory_nodes + memory_provenance tables for Visible Memory write primitives.
-- memory_nodes: one row per disclosed signal (allergy, cultural rhythm, palate note, family rhythm).
-- memory_provenance: 1-to-many sidecar (CASCADE DELETE) capturing source, captured_at, confidence.
-- Onboarding seeding writes nodes + provenance pairs sequentially (no multi-statement transactions
-- via supabase-js); partial seeding is acceptable per Story 2.13 design (Epic 7 reconciles orphans).
-- All access flows through the API service-role client (bypasses RLS). Direct Supabase-client SELECTs
-- are scoped to the caller's current_household_id.

CREATE TYPE node_type AS ENUM (
  'preference',
  'rhythm',
  'cultural_rhythm',
  'allergy',
  'child_obsession',
  'school_policy',
  'other'
);

CREATE TYPE source_type AS ENUM (
  'onboarding',
  'turn',
  'tool',
  'user_edit',
  'plan_outcome',
  'import'
);

CREATE TABLE memory_nodes (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id      uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  node_type         node_type   NOT NULL,
  facet             text        NOT NULL,
  subject_child_id  uuid        REFERENCES children(id) ON DELETE SET NULL,
  prose_text        text        NOT NULL,
  soft_forget_at    timestamptz,
  hard_forgotten    boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memory_nodes_household_type_forgotten_idx
  ON memory_nodes (household_id, node_type, hard_forgotten);

CREATE TABLE memory_provenance (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  memory_node_id  uuid        NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  source_type     source_type NOT NULL,
  source_ref      jsonb       NOT NULL,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  captured_by     uuid        REFERENCES users(id) ON DELETE SET NULL,
  confidence      numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  superseded_by   uuid        REFERENCES memory_provenance(id) ON DELETE SET NULL
);

CREATE INDEX memory_provenance_node_idx
  ON memory_provenance (memory_node_id);

-- Reuses shared set_updated_at() function (e.g., 20260515000200_cultural_priors_updated_at_trigger).
-- Re-declared with CREATE OR REPLACE so this migration is independently runnable.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_nodes_updated_at
  BEFORE UPDATE ON memory_nodes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE memory_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_provenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_nodes_primary_parent_select_policy ON memory_nodes
  FOR SELECT USING (
    household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY memory_provenance_primary_parent_select_policy ON memory_provenance
  FOR SELECT USING (
    memory_node_id IN (
      SELECT id FROM memory_nodes
      WHERE household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
    )
  );
