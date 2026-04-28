-- Story 2.9 code review: use DB server now() for parental notice acknowledgment timestamp.
-- PostgREST UPDATE payloads accept only JSON values, not SQL expressions;
-- a stored function is required to call NOW() server-side.
--
-- The conditional WHERE clause (IS DISTINCT FROM) makes the write atomic:
-- if a concurrent request already acknowledged the same version, the UPDATE
-- skips and returns is_new_acknowledgment = false — preventing duplicate
-- audit events without application-layer locking.
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
  WHERE id = p_user_id
    AND parental_notice_acknowledged_version IS DISTINCT FROM p_document_version;

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

-- Restrict execution to the service_role (API backend) only.
-- SECURITY DEFINER bypasses RLS; PUBLIC access would allow any Supabase client
-- to acknowledge on behalf of an arbitrary user_id, bypassing API-layer auth.
-- Mirrors the create_household_and_user precedent from Story 2.1.
REVOKE EXECUTE ON FUNCTION ack_parental_notice(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ack_parental_notice(UUID, TEXT) TO service_role;
