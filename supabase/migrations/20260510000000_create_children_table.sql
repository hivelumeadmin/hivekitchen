-- Story 2.10: children table with envelope-encrypted sensitive fields.
-- declared_allergens, cultural_identifiers, dietary_preferences store
-- AES-256-GCM ciphertext (base64 text). In dev/test NODE_ENV: NOOP:base64(JSON).
-- school_policies table deferred — school constraints captured as free-text
-- school_policy_notes until Story 3.x normalizes school policy management.
CREATE TABLE children (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id          uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                  text        NOT NULL,
  age_band              text        NOT NULL
                        CHECK (age_band IN ('toddler','child','preteen','teen')),
  school_policy_notes   text,
  declared_allergens    text,
  cultural_identifiers  text,
  dietary_preferences   text,
  allergen_rule_version text        NOT NULL DEFAULT 'v1',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX children_household_id_idx ON children (household_id);
