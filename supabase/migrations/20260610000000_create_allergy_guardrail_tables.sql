-- Story 3.1: deterministic allergy guardrail.
--   allergy_rules        — top-9 FALCPA system rows + parent-declared household/child rows.
--                          household_id IS NULL identifies the FALCPA reference set.
--                          child_id IS NULL means the rule applies to every child in the household.
--   guardrail_decisions  — append-only audit row written by the authoritative clearOrReject() path.
--                          plan_id is nullable; Story 3.5 adds the FK to plans once that table lands.
-- All writes are performed by the API service-role client (RLS bypassed).
-- Authenticated callers may only SELECT rows scoped to their current household.

CREATE TYPE guardrail_verdict_enum AS ENUM ('cleared', 'blocked', 'uncertain');

CREATE TABLE allergy_rules (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id  uuid        REFERENCES households(id) ON DELETE CASCADE,
  child_id      uuid        REFERENCES children(id) ON DELETE CASCADE,
  allergen      text        NOT NULL,
  rule_type     text        NOT NULL CHECK (rule_type IN ('falcpa', 'parent_declared')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX allergy_rules_household_child_idx
  ON allergy_rules (household_id, child_id);

-- FALCPA top-9 system rows: household_id and child_id NULL identifies the reference set.
INSERT INTO allergy_rules (household_id, child_id, allergen, rule_type) VALUES
  (NULL, NULL, 'peanuts',    'falcpa'),
  (NULL, NULL, 'tree_nuts',  'falcpa'),
  (NULL, NULL, 'milk',       'falcpa'),
  (NULL, NULL, 'eggs',       'falcpa'),
  (NULL, NULL, 'wheat',      'falcpa'),
  (NULL, NULL, 'soy',        'falcpa'),
  (NULL, NULL, 'fish',       'falcpa'),
  (NULL, NULL, 'shellfish',  'falcpa'),
  (NULL, NULL, 'sesame',     'falcpa');

CREATE TABLE guardrail_decisions (
  id                 uuid                   NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id            uuid,
  household_id       uuid                   NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  verdict            guardrail_verdict_enum NOT NULL,
  guardrail_version  text                   NOT NULL,
  conflicts          jsonb                  NOT NULL DEFAULT '[]'::jsonb,
  evaluated_at       timestamptz            NOT NULL DEFAULT now(),
  request_id         uuid                   NOT NULL
);

CREATE INDEX guardrail_decisions_household_evaluated_at_idx
  ON guardrail_decisions (household_id, evaluated_at DESC);

ALTER TABLE allergy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrail_decisions ENABLE ROW LEVEL SECURITY;

-- Authenticated callers see FALCPA system rows + their own household's parent-declared rows.
CREATE POLICY allergy_rules_household_select_policy ON allergy_rules
  FOR SELECT USING (
    household_id IS NULL
    OR household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
  );

-- Authenticated callers see only their own household's guardrail decisions.
CREATE POLICY guardrail_decisions_household_select_policy ON guardrail_decisions
  FOR SELECT USING (
    household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())
  );
