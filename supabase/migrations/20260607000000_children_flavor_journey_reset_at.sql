-- Story 7-S7: track the last annual flavor-journey reset per child.
-- NULL = never reset. 365-day cooldown is enforced at the application layer.
ALTER TABLE children ADD COLUMN flavor_journey_reset_at timestamptz NULL;
