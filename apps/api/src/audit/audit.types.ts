export const AUDIT_EVENT_TYPES = [
  // plan
  'plan.generated',
  'plan.regenerated',
  'plan.regeneration_requested',
  'plan.hard_fail',
  'brief.projection.failure',
  // memory
  'memory.forgotten',
  'memory.updated',
  'memory.seeded',
  // heart_note
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
  // cultural
  'template.state_changed',
  // onboarding
  'onboarding.mental_model_shown',
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
