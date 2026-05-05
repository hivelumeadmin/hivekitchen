-- Story 3.12: parent-initiated plan mutation events.
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.item_swapped';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.day_paused';
