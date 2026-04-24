import { describe, it, expect, vi } from 'vitest';
import type { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';
import type { AuditWriteInput } from './audit.types.js';

describe('AuditService', () => {
  it('calls repository.insert with the full input', async () => {
    const insert = vi.fn<(input: AuditWriteInput) => Promise<void>>().mockResolvedValue(undefined);
    const repo = { insert } as unknown as AuditRepository;
    const service = new AuditService(repo);

    const input: AuditWriteInput = {
      event_type: 'auth.login',
      user_id: 'user-uuid',
      request_id: 'req-uuid',
      metadata: { method: 'email' },
    };

    await service.write(input);
    expect(insert).toHaveBeenCalledWith(input);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('propagates repository errors (caller is responsible for fire-and-forget)', async () => {
    const insert = vi
      .fn<(input: AuditWriteInput) => Promise<void>>()
      .mockRejectedValue(new Error('db error'));
    const repo = { insert } as unknown as AuditRepository;
    const service = new AuditService(repo);

    await expect(
      service.write({
        event_type: 'auth.login',
        request_id: 'req-uuid',
        metadata: {},
      }),
    ).rejects.toThrow('db error');
  });

  it('supports multi-stage plan.generated writes with correlation_id', async () => {
    const insert = vi.fn<(input: AuditWriteInput) => Promise<void>>().mockResolvedValue(undefined);
    const repo = { insert } as unknown as AuditRepository;
    const service = new AuditService(repo);

    const input: AuditWriteInput = {
      event_type: 'plan.generated',
      household_id: 'hh-uuid',
      correlation_id: 'plan-uuid',
      request_id: 'req-uuid',
      stages: [
        { stage: 'context_loaded', context_size: 4200 },
        { stage: 'guardrail_verdict', verdict: 'cleared' },
      ],
      metadata: { plan_revision: 1 },
    };

    await service.write(input);
    expect(insert).toHaveBeenCalledWith(input);
  });
});
