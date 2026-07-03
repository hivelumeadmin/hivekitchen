-- Epic 13-s9 (routing-spec §9 #3) — audit event for the conversational
-- snack-SKU swap (PlansService.swapSlotSnackSku).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.slot_snack_swapped';
