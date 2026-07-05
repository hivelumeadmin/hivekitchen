import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MailService } from '@sendgrid/mail';
import type { AuditService } from '../audit/audit.service.js';
import { DataExportRepository } from '../modules/data-export/data-export.repository.js';

export const DATA_EXPORT_QUEUE = 'data-export';

const EXPORT_BUCKET = 'data-exports';
const THIRTY_DAYS_S = 2592000;
// Placeholder sender — no SendGrid `send()` call site exists in the codebase yet
// (heart-note delivery only flips status; it never emails). Replace with the
// project's verified sender when one is established.
const EXPORT_FROM = 'no-reply@hivekitchen.app';

export interface DataExportJobData {
  household_id: string;
  user_id: string;
  request_id: string;
}

export interface DataExportDeps {
  repo: DataExportRepository;
  // Storage upload + signed URL and auth.admin.getUserById live on the
  // service-role client.
  supabase: SupabaseClient;
  sendgrid: Pick<MailService, 'send'>;
  audit: Pick<AuditService, 'write'>;
  logger: FastifyBaseLogger;
  jwtSecret: string;
}

// Story 7-S10 — the export worker body, extracted from the BullMQ callback so it
// can be unit-tested without standing up BullMQ. Composes the full household
// snapshot, HMAC-signs it, uploads to private Supabase Storage, mints a 30-day
// signed URL, emails it (best-effort), and writes an account.exported audit row
// (best-effort). Storage upload / signed-URL errors re-throw so BullMQ retries.
export async function runDataExport(
  deps: DataExportDeps,
  data: DataExportJobData,
): Promise<void> {
  const { household_id, user_id, request_id } = data;

  // ── 1. Compose snapshot ──────────────────────────────────────────────────
  const [
    household,
    children,
    memoryNodes,
    plans,
    heartNotes,
    lunchLinkSessions,
    vpcConsents,
    consentAuditSubset,
  ] = await Promise.all([
    deps.repo.getHousehold(household_id),
    deps.repo.getChildren(household_id),
    deps.repo.getMemoryNodes(household_id),
    deps.repo.getRecentPlans(household_id),
    deps.repo.getHeartNotes(household_id),
    deps.repo.getLunchLinkSessions(household_id),
    deps.repo.getVpcConsents(household_id),
    deps.repo.getConsentAuditSubset(household_id),
  ]);

  const householdRow = (household ?? {}) as Record<string, unknown>;
  const billingSummary = {
    tier: householdRow['subscription_tier'] ?? null,
    status: householdRow['subscription_status'] ?? null,
  };

  const snapshot = {
    exported_at: new Date().toISOString(),
    household,
    billing_summary: billingSummary,
    children,
    memory_nodes: memoryNodes,
    plans,
    heart_notes: heartNotes,
    lunch_link_sessions: lunchLinkSessions,
    vpc_consents: vpcConsents,
    consent_audit_subset: consentAuditSubset,
  };

  // ── 2. HMAC-sign ─────────────────────────────────────────────────────────
  const dataJson = JSON.stringify(snapshot);
  const signature =
    'sha256=' + createHmac('sha256', deps.jwtSecret).update(dataJson).digest('hex');
  const exportPayload = { data: snapshot, signature };
  const exportJson = JSON.stringify(exportPayload, null, 2);

  // ── 3. Upload to Supabase Storage (throws → BullMQ retry) ────────────────
  const isoDate = new Date().toISOString().slice(0, 10);
  const exportPath = `exports/${household_id}/${isoDate}.json`;

  const { error: uploadError } = await deps.supabase.storage
    .from(EXPORT_BUCKET)
    .upload(exportPath, Buffer.from(exportJson), {
      contentType: 'application/json',
      upsert: true,
    });
  if (uploadError) throw uploadError;

  // ── 4. Create 30-day signed URL (throws → BullMQ retry) ──────────────────
  const { data: signedUrlData, error: urlError } = await deps.supabase.storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(exportPath, THIRTY_DAYS_S);
  if (urlError) throw urlError;
  const signedUrl = signedUrlData.signedUrl;
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_S * 1000).toISOString();

  // ── 5. Get user email (for SendGrid) ─────────────────────────────────────
  const {
    data: { user },
    error: userError,
  } = await deps.supabase.auth.admin.getUserById(user_id);
  if (userError) {
    deps.logger.warn(
      { err: userError, module: 'data-export', action: 'email.user_lookup_failed', user_id },
      'data-export: getUserById failed — skipping email',
    );
  }
  const userEmail = userError ? undefined : user?.email;

  // ── 6. Send email (best-effort — never halts the job) ─────────────────────
  if (userEmail) {
    try {
      await deps.sendgrid.send({
        to: userEmail,
        from: EXPORT_FROM,
        subject: 'Your HiveKitchen data export is ready',
        text: [
          'Your HiveKitchen data export is ready.',
          '',
          `Download it here: ${signedUrl}`,
          '',
          `This link expires on ${new Date(expiresAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}.`,
          '',
          'The export includes all data HiveKitchen holds for your household, with encrypted fields decrypted to plain text.',
        ].join('\n'),
      });
    } catch (emailErr) {
      deps.logger.warn(
        { err: emailErr, module: 'data-export', action: 'email.failed', household_id },
        'data-export: email delivery failed — export uploaded, continuing to audit',
      );
    }
  } else {
    deps.logger.warn(
      { module: 'data-export', action: 'email.no_address', user_id },
      'data-export: no email on user record — skipping email',
    );
  }

  // ── 7. Audit row (best-effort — never halts the job) ──────────────────────
  try {
    await deps.audit.write({
      event_type: 'account.exported',
      household_id,
      user_id,
      request_id,
      metadata: { export_path: exportPath, signed_url_expires_at: expiresAt },
    });
  } catch (auditErr) {
    deps.logger.warn(
      { err: auditErr, module: 'data-export', action: 'audit.failed', household_id },
      'data-export: audit write failed — export delivered, continuing',
    );
  }

  deps.logger.info(
    { module: 'data-export', action: 'export.complete', household_id, export_path: exportPath },
    'data-export: export composed, uploaded, and emailed',
  );
}

// On-demand worker-only plugin: NO upsertJobScheduler. The POST route enqueues a
// job via queue.add(); this worker consumes it (mirrors plan-regeneration.job.ts,
// not the cron-style memory-forget.job.ts).
const dataExportPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error('dataExportPlugin requires supabase — register supabasePlugin first');
  }

  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;

  fastify.bullmq.getWorker(DATA_EXPORT_QUEUE, async (job: Job<DataExportJobData>) => {
    const repo = new DataExportRepository(fastify.supabase, kek);
    await runDataExport(
      {
        repo,
        supabase: fastify.supabase,
        sendgrid: fastify.sendgrid,
        audit: fastify.auditService,
        logger: fastify.log,
        jwtSecret: fastify.env.JWT_SECRET,
      },
      job.data,
    );
  });
};

export const dataExportJobPlugin = fp(dataExportPlugin, {
  name: 'data-export-job',
});
