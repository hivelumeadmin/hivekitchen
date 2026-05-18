-- Fix ambiguous column reference in ack_parental_notice (PostgreSQL error 42702).
--
-- RETURNS TABLE declares output variables whose names are identical to the
-- users table columns. The UPDATE WHERE clause's unqualified reference to
-- parental_notice_acknowledged_version is therefore ambiguous between the
-- PL/pgSQL output variable and the table column.
-- Fix: qualify all column references in the UPDATE with the table name.

CREATE OR REPLACE FUNCTION ack_parental_notice(p_user_id UUID, p_document_version TEXT)
RETURNS TABLE(
  parental_notice_acknowledged_at TIMESTAMPTZ,
  parental_notice_acknowledged_version TEXT,
  is_new_acknowledgment BOOLEAN
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_updated INT;
BEGIN
  UPDATE users
  SET
    parental_notice_acknowledged_at = NOW(),
    parental_notice_acknowledged_version = p_document_version,
    updated_at = NOW()
  WHERE users.id = p_user_id
    AND users.parental_notice_acknowledged_version IS DISTINCT FROM p_document_version;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  RETURN QUERY
  SELECT
    u.parental_notice_acknowledged_at,
    u.parental_notice_acknowledged_version,
    (v_rows_updated > 0)::BOOLEAN
  FROM users u
  WHERE u.id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION ack_parental_notice(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ack_parental_notice(UUID, TEXT) TO service_role;
