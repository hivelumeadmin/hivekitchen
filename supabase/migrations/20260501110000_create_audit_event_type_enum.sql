-- Rollback: DROP TYPE audit_event_type;
-- Note: Adding values requires ALTER TYPE audit_event_type ADD VALUE '<value>';
-- TypeScript mirror must be updated in the same PR: apps/api/src/audit/audit.types.ts

CREATE TYPE audit_event_type AS ENUM (
  -- plan
  'plan.generated',
  'plan.regenerated',
  'plan.regeneration_requested',
  'plan.hard_fail',
  -- memory
  'memory.forgotten',
  'memory.updated',
  -- heart_note
  'heart_note.sent',
  'heart_note.delivered',
  'heart_note.delivery_failed',
  -- lunch_link
  'lunch_link.created',
  'lunch_link.opened',
  'lunch_link.rated',
  'lunch_link.expired',
  -- voice
  'voice.session_started',
  'voice.session_ended',
  'voice.webhook_auth_failed',
  -- billing
  'billing.subscribed',
  'billing.cancelled',
  'billing.payment_failed',
  'billing.payment_recovered',
  'billing.upgraded',
  'billing.downgraded',
  'billing.gift_redeemed',
  -- vpc
  'vpc.consented',
  -- account
  'account.created',
  'account.updated',
  'account.deleted',
  -- auth
  'auth.login',
  'auth.logout',
  'auth.refresh_rotated',
  'auth.token_reuse_revoked',
  'auth.password_reset_initiated',
  -- allergy
  'allergy.guardrail_rejection',
  'allergy.uncertainty',
  'allergy.check_overridden',
  -- agent
  'agent.orchestrator_run',
  -- webhook
  'webhook.received',
  'webhook.signature_failed',
  -- invite
  'invite.sent',
  'invite.redeemed',
  'invite.revoked',
  'invite.expired',
  -- llm.provider
  'llm.provider.failover'
);
