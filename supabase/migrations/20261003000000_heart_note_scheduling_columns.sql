-- Slice 4-S6: add scheduling outcome columns to heart_notes.
-- delivered_at: set by the heart-note-delivery BullMQ job at 06:00 UTC on the
--   scheduled date.
-- cancelled_at: set by PATCH /v1/heart-notes/:id when status transitions to
--   'cancelled'.
-- Both nullable — rows in 'draft'/'scheduled'/'viewed'/'rated' status have
-- NULL in both. The existing status CHECK constraint already covers all six
-- values, so no constraint change is needed.

ALTER TABLE heart_notes
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN cancelled_at timestamptz;
