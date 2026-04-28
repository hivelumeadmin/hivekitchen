-- Story 2.9: track which parental-notice document version the user
-- acknowledged. Mirrors the vpc_consents.document_version pattern from
-- Story 2.8. Future v2 notice releases will require re-acknowledgment by
-- setting this column back to NULL via a separate migration when v2 ships.
ALTER TABLE users ADD COLUMN IF NOT EXISTS parental_notice_acknowledged_version text;
