-- Story 12-S11: proactive-nudge traceability column on thread_turns.
--
-- When LumiService.persistNudge() writes a proactive Lumi turn, it stamps the
-- trigger that produced it (plan_completed, allergen_flagged, …) in this column.
-- The column is write-only from the application layer: it is NOT in TURN_COLUMNS,
-- NOT in the Turn contract, and NOT returned by GET /v1/lumi/threads/:id/turns.
-- It exists for internal traceability / future analytics only. No index — there
-- are no read queries against it at MVP.

ALTER TABLE thread_turns ADD COLUMN nudge_trigger TEXT NULL;
