export const AUDIT_EVENT_TYPES = [
  // planner (agent observability — emitted when LLM output fails schema validation)
  'planner.bad_output',
  // plan
  'plan.generated',
  'plan.regenerated',
  'plan.regeneration_requested',
  'plan.policy_regeneration_triggered',
  'plan.adjustment_triggered',
  'plan.hard_fail',
  'plan.cultural_degraded',
  'plan.generation.failed',
  'plan.on_demand_requested', // Story 3-S34 — user-triggered "compose now"
  'plan.item_swapped',
  // Story 3-DM-C1 Phase 9b part 4 step 2 — tree-shape swap events. The flat
  // 'plan.item_swapped' stays alive until the swap-route rewrite (step 3)
  // retires it; the three below cover the canonical-model decomposition.
  'plan.main_swapped',
  'plan.slot_recipe_swapped',
  'plan.slot_snack_swapped', // Epic 13-s9 — snack-SKU swap (routing-spec §9 #3)
  'plan.variation_updated',
  'plan.week_confirmed', // Epic 13-s10 — real "Confirm the week" commit
  'plan.child_paused_on_day',
  'plan.day_paused',
  'plan.day_override_set',
  'plan.day_override_reverted',
  'plan.extra_bias_applied',
  'plan.extra_proposal_created',
  // Story 3.27 — preparation-method variant active learning
  'plan.variant_proposal_created',
  'plan.variant_proposal_confirmed',
  'plan.variant_proposal_rejected',
  'brief.projection.failure',
  // memory
  'memory.forgotten',
  'memory.updated',
  'memory.seeded',
  'memory.hard_forgotten', // Story 7-S5 — nightly promotion job tombstone
  'memory.learning_moment_confirmed', // 5-S8: user tapped [Yes, keep it in mind]
  'memory.learning_moment_dismissed', // 5-S8: user tapped [Not for us], 7-day suppress set
  'memory.learning_moment_tell_more', // 5-S8: user tapped [Tell me more], no suppress
  // heart_note
  'heart_note.created',
  'heart_note.updated',
  'heart_note.sent',
  'heart_note.delivered',
  'heart_note.delivery_failed',
  // lunch_link
  'lunch_link.created',
  'lunch_link.opened',
  'lunch_link.rated',
  'lunch_link.expired',
  'lunch_link.suppressed',    // Story 3.28: parent paused Lunch Link for (child, date)
  'lunch_link.unsuppressed',  // Story 3.28: parent resumed Lunch Link for (child, date)
  // voice
  'voice.session_started',
  'voice.session_ended',
  'voice.webhook_auth_failed',
  'voice.tts_token_issued',
  'voice.stt_token_issued',
  'voice.tts_synthesized', // slice 2-S20: one-shot TTS for on-page narration
  // billing
  'billing.subscribed',
  'billing.cancelled',
  'billing.payment_failed',
  'billing.payment_recovered',
  'billing.upgraded',
  'billing.downgraded',
  'billing.gift_redeemed',
  // vpc
  'vpc.consented',
  // parental_notice
  'parental_notice.acknowledged',
  // account
  'account.created',
  'account.updated',
  'account.deleted',
  'account.exported',   // Story 7-S10 — data portability export
  'account.deletion_requested', // Story 7-S11 — soft-delete + login lock
  'account.hard_deleted',       // Story 7-S11 — 30-day cascade complete
  // auth
  'auth.login',
  'auth.logout',
  'auth.refresh_rotated',
  'auth.token_reuse_revoked',
  'auth.password_reset_initiated',
  'auth.password_reset_completed',
  // allergy
  'allergy.guardrail_rejection',
  'allergy.uncertainty',
  'allergy.check_overridden',
  // agent
  'agent.orchestrator_run',
  // recipe (Story 3-31)
  'recipe.agent_fetch',
  'recipe.candidate.cache_miss',
  // webhook
  'webhook.received',
  'webhook.signature_failed',
  // invite
  'invite.sent',
  'invite.redeemed',
  'invite.revoked',
  'invite.expired',
  // llm.provider
  'llm.provider.failover',
  'llm.provider.recovered',
  // children
  'child.add',
  'child.bag_updated',
  'child.extra_rules_updated',
  'child.flavor_journey_reset', // Story 7-S7
  // households
  'household.extra_library_item_created',
  'household.extra_library_item_archived',
  'household.snack_sku_added', // Story 3-S41 — family snack shelf add
  'household.snack_sku_archived', // Story 3-S41 — family snack shelf remove
  'household.profile_updated',
  'household.sovereignty_mode_changed',
  'household.geolocation_consent', // 5-S14: geolocation opt-in consent (NFR-PRIV-3)
  'household.auto_compose_changed', // 3-S35: weekly auto-compose enrollment toggle
  'household.calendar_updated', // 15-s1: family-calendar term/exception write
  // school policies
  'school_policy.updated',
  // cultural
  'template.state_changed',
  // onboarding
  'onboarding.mental_model_shown',
  // onboarding resume (slice 2-S26)
  'onboarding.resume_offered',
  'onboarding.resumed',
  'onboarding.reset',
  // tile
  'tile.edit_retried',
] as const;

type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

interface AuditStage {
  stage: string;
  [key: string]: unknown;
}

export interface AuditWriteInput {
  event_type: AuditEventType;
  household_id?: string;
  user_id?: string;
  correlation_id?: string;
  request_id: string;
  stages?: AuditStage[];
  metadata: Record<string, unknown>;
}

// Slice 4-S17 — read-side row shape for the allergy transparency log. Only the
// three allergy.* event types are ever returned by
// AuditRepository.findAllergyEventsByHousehold.
export type AllergyAuditRow = {
  id: string;
  event_type: 'allergy.guardrail_rejection' | 'allergy.uncertainty' | 'allergy.check_overridden';
  metadata: Record<string, unknown>;
  created_at: string;
};

// Slice 7-S9 — read-side row shape for the consent history view.
// Covers vpc.consented + parental_notice.acknowledged + account.* events.
export type ConsentAuditRow = {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
