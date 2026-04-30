-- Story 2.11: auto-refresh updated_at on cultural_priors mutations.
-- Reuses the shared set_updated_at() function created by earlier migrations
-- (e.g., 20260510000500_children_updated_at_trigger). Re-declared here as
-- CREATE OR REPLACE so this migration is independently runnable.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cultural_priors_updated_at
  BEFORE UPDATE ON cultural_priors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
