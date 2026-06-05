import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MailService } from '@sendgrid/mail';
import type { AuditService } from '../audit/audit.service.js';
import type { DataExportRepository } from '../modules/data-export/data-export.repository.js';
import { runDataExport, type DataExportJobData } from './data-export.job.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const JWT_SECRET = 'a'.repeat(32);

const JOB_DATA: DataExportJobData = {
  household_id: HOUSEHOLD_ID,
  user_id: USER_ID,
  request_id: REQUEST_ID,
};

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: vi.fn(),
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

const REPO_METHODS = [
  'getHousehold',
  'getChildren',
  'getMemoryNodes',
  'getRecentPlans',
  'getHeartNotes',
  'getLunchLinkSessions',
  'getVpcConsents',
  'getConsentAuditSubset',
] as const;

function buildRepo() {
  const methods: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of REPO_METHODS) {
    methods[name] = vi.fn().mockResolvedValue(
      name === 'getHousehold'
        ? { id: HOUSEHOLD_ID, subscription_tier: 'free', subscription_status: 'active' }
        : [],
    );
  }
  return { repo: methods as unknown as DataExportRepository, methods };
}

interface SupabaseMockOpts {
  uploadError?: unknown;
  signedUrlError?: unknown;
  userEmail?: string | null;
  getUserByIdError?: unknown;
}

function buildSupabaseMock(opts: SupabaseMockOpts = {}) {
  const upload = vi.fn().mockResolvedValue({ error: opts.uploadError ?? null });
  const createSignedUrl = vi.fn().mockResolvedValue(
    opts.signedUrlError !== undefined
      ? { data: null, error: opts.signedUrlError }
      : { data: { signedUrl: 'https://signed.example/export' }, error: null },
  );
  const storageApi = { upload, createSignedUrl };
  const email = opts.userEmail === undefined ? 'parent@example.com' : opts.userEmail;
  const getUserById = vi.fn().mockResolvedValue(
    opts.getUserByIdError !== undefined
      ? { data: { user: null }, error: opts.getUserByIdError }
      : { data: { user: email === null ? null : { id: USER_ID, email } }, error: null },
  );
  const supabase = {
    storage: { from: vi.fn(() => storageApi) },
    auth: { admin: { getUserById } },
  } as unknown as SupabaseClient;
  return { supabase, upload, createSignedUrl, getUserById };
}

function buildDeps(overrides: {
  supabaseOpts?: SupabaseMockOpts;
  sendgrid?: Pick<MailService, 'send'>;
  audit?: Pick<AuditService, 'write'>;
} = {}) {
  const { repo, methods } = buildRepo();
  const sb = buildSupabaseMock(overrides.supabaseOpts);
  const sendgrid =
    overrides.sendgrid ?? ({ send: vi.fn().mockResolvedValue(undefined) } as unknown as Pick<MailService, 'send'>);
  const audit =
    overrides.audit ?? ({ write: vi.fn().mockResolvedValue(undefined) } as unknown as Pick<AuditService, 'write'>);
  const logger = buildLogger();
  const deps = { repo, supabase: sb.supabase, sendgrid, audit, logger, jwtSecret: JWT_SECRET };
  return { deps, methods, sb, sendgrid, audit, logger };
}

describe('runDataExport', () => {
  it('composes from all 8 data sources', async () => {
    const { deps, methods } = buildDeps();
    await runDataExport(deps, JOB_DATA);
    for (const name of REPO_METHODS) {
      expect(methods[name]).toHaveBeenCalledWith(HOUSEHOLD_ID);
    }
  });

  it('uploads an HMAC-signed envelope to exports/{household}/{date}.json', async () => {
    const { deps, sb } = buildDeps();
    await runDataExport(deps, JOB_DATA);

    expect(sb.upload).toHaveBeenCalledTimes(1);
    const [path, buffer, uploadOpts] = sb.upload.mock.calls[0] as [
      string,
      Buffer,
      { contentType: string; upsert: boolean },
    ];
    expect(path).toMatch(
      new RegExp(`^exports/${HOUSEHOLD_ID}/\\d{4}-\\d{2}-\\d{2}\\.json$`),
    );
    expect(uploadOpts).toMatchObject({ contentType: 'application/json', upsert: true });

    const payload = JSON.parse(buffer.toString()) as { data: unknown; signature: string };
    expect(payload.signature.startsWith('sha256=')).toBe(true);
    // 'sha256=' (7) + 64 hex chars.
    expect(payload.signature).toHaveLength(71);
  });

  it('creates a 30-day signed URL for the uploaded path', async () => {
    const { deps, sb } = buildDeps();
    await runDataExport(deps, JOB_DATA);

    expect(sb.createSignedUrl).toHaveBeenCalledTimes(1);
    const [path, expiry] = sb.createSignedUrl.mock.calls[0] as [string, number];
    expect(expiry).toBe(2592000);
    expect(path).toMatch(new RegExp(`^exports/${HOUSEHOLD_ID}/`));
  });

  it('sends a single export-ready email with the correct subject', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { deps } = buildDeps({ sendgrid: { send } as unknown as Pick<MailService, 'send'> });
    await runDataExport(deps, JOB_DATA);

    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0]![0] as { to: string; subject: string };
    expect(arg.to).toBe('parent@example.com');
    expect(arg.subject).toBe('Your HiveKitchen data export is ready');
  });

  it('continues to the audit write when email delivery fails (best-effort)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('sendgrid down'));
    const write = vi.fn().mockResolvedValue(undefined);
    const { deps, logger } = buildDeps({
      sendgrid: { send } as unknown as Pick<MailService, 'send'>,
      audit: { write } as unknown as Pick<AuditService, 'write'>,
    });

    await expect(runDataExport(deps, JOB_DATA)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'account.exported', household_id: HOUSEHOLD_ID }),
    );
  });

  it('does not throw when the audit write fails (best-effort)', async () => {
    const write = vi.fn().mockRejectedValue(new Error('audit down'));
    const { deps, logger } = buildDeps({
      audit: { write } as unknown as Pick<AuditService, 'write'>,
    });

    await expect(runDataExport(deps, JOB_DATA)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('re-throws on storage upload error — no email, no audit (BullMQ retry path)', async () => {
    const send = vi.fn();
    const write = vi.fn();
    const { deps } = buildDeps({
      supabaseOpts: { uploadError: new Error('storage 500') },
      sendgrid: { send } as unknown as Pick<MailService, 'send'>,
      audit: { write } as unknown as Pick<AuditService, 'write'>,
    });

    await expect(runDataExport(deps, JOB_DATA)).rejects.toThrow('storage 500');
    expect(send).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('continues to audit when getUserById fails (best-effort — not a re-throw)', async () => {
    const send = vi.fn();
    const write = vi.fn().mockResolvedValue(undefined);
    const { deps, logger } = buildDeps({
      supabaseOpts: { getUserByIdError: new Error('auth admin 500') },
      sendgrid: { send } as unknown as Pick<MailService, 'send'>,
      audit: { write } as unknown as Pick<AuditService, 'write'>,
    });

    await expect(runDataExport(deps, JOB_DATA)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'account.exported', household_id: HOUSEHOLD_ID }),
    );
  });

  it('re-throws on signed-URL error — no email, no audit (BullMQ retry path)', async () => {
    const send = vi.fn();
    const write = vi.fn();
    const { deps } = buildDeps({
      supabaseOpts: { signedUrlError: new Error('sign 500') },
      sendgrid: { send } as unknown as Pick<MailService, 'send'>,
      audit: { write } as unknown as Pick<AuditService, 'write'>,
    });

    await expect(runDataExport(deps, JOB_DATA)).rejects.toThrow('sign 500');
    expect(send).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
