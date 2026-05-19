export const AUDIT_EVENT_TYPES = [
  // plan
  'plan.generated',
  'plan.regenerated',
  'plan.regeneration_requested',
  'plan.policy_regeneration_triggered',
  'plan.adjustment_triggered',
  'plan.hard_fail',
  'plan.generation.failed',
  'plan.item_swapped',
  'plan.day_paused',
  'plan.day_override_set',
  'plan.day_override_reverted',
  'plan.extra_bias_applied',
  'plan.extra_proposal_created',
  'brief.projection.failure',
  // memory
  'memory.forgotten',
  'memory.updated',
  'memory.seeded',
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
  // voice
  'voice.session_started',
  'voice.session_ended',
  'voice.webhook_auth_failed',
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
  // children
  'child.add',
  'child.bag_updated',
  'child.extra_rules_updated',
  // households
  'household.extra_library_item_created',
  'household.extra_library_item_archived',
  'household.profile_updated',
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

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export interface AuditStage {
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
