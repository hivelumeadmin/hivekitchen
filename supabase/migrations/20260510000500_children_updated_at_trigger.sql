-- Automatically maintain updated_at on children rows.
-- Uses the shared set_updated_at() function if it already exists (e.g. created by
-- the households trigger migration), otherwise creates it here.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER children_set_updated_at
  BEFORE UPDATE ON children
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
