import { describe, it, expect, vi } from 'vitest';
import type { Readable } from 'node:stream';
import { AllergyTransparencyLogSchema } from '@hivekitchen/contracts';
import { AllergyTransparencyService } from './allergy-transparency.service.js';
import type { AuditRepository } from '../../audit/audit.repository.js';
import type { AllergyAuditRow } from '../../audit/audit.types.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

function row(overrides: Partial<AllergyAuditRow> = {}): AllergyAuditRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    event_type: 'allergy.guardrail_rejection',
    metadata: {},
    created_at: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

function repoReturning(rows: AllergyAuditRow[]): AuditRepository {
  return {
    findAllergyEventsByHousehold: vi.fn().mockResolvedValue(rows),
  } as unknown as AuditRepository;
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('AllergyTransparencyService.exportAsJson', () => {
  it('maps guardrail_rejection to its label and joins conflicts into detail', async () => {
    const svc = new AllergyTransparencyService(
      repoReturning([
        row({ event_type: 'allergy.guardrail_rejection', metadata: { conflicts: ['peanut', 'tree_nut'] } }),
      ]),
    );

    const log = await svc.exportAsJson(HOUSEHOLD_ID);

    expect(log.events[0]?.label).toBe('Plan blocked due to allergen conflict');
    expect(log.events[0]?.detail).toBe('peanut, tree_nut');
  });

  it('maps uncertainty to its label and joins flagged_items into detail', async () => {
    const svc = new AllergyTransparencyService(
      repoReturning([
        row({ event_type: 'allergy.uncertainty', metadata: { flagged_items: ['Thai curry paste'] } }),
      ]),
    );

    const log = await svc.exportAsJson(HOUSEHOLD_ID);

    expect(log.events[0]?.label).toBe('Ingredient safety could not be confirmed');
    expect(log.events[0]?.detail).toBe('Thai curry paste');
  });

  it('maps check_overridden to its label and stringifies reason', async () => {
    const svc = new AllergyTransparencyService(
      repoReturning([
        row({ event_type: 'allergy.check_overridden', metadata: { reason: 'parent confirmed safe' } }),
      ]),
    );

    const log = await svc.exportAsJson(HOUSEHOLD_ID);

    expect(log.events[0]?.label).toBe('Parent overrode allergy safety check');
    expect(log.events[0]?.detail).toBe('parent confirmed safe');
  });

  it('returns null detail when the array metadata field is missing', async () => {
    const svc = new AllergyTransparencyService(
      repoReturning([row({ event_type: 'allergy.guardrail_rejection', metadata: {} })]),
    );

    const log = await svc.exportAsJson(HOUSEHOLD_ID);

    expect(log.events[0]?.detail).toBeNull();
  });

  it('returns null detail when check_overridden reason is null', async () => {
    const svc = new AllergyTransparencyService(
      repoReturning([row({ event_type: 'allergy.check_overridden', metadata: { reason: null } })]),
    );

    const log = await svc.exportAsJson(HOUSEHOLD_ID);

    expect(log.events[0]?.detail).toBeNull();
  });

  it('normalizes the timestamp to a Z-suffixed ISO string that satisfies the contract', async () => {
    const svc = new AllergyTransparencyService(
      repoReturning([row({ created_at: '2026-06-01T10:00:00+00:00' })]),
    );

    const log = await svc.exportAsJson(HOUSEHOLD_ID);

    expect(log.events[0]?.timestamp).toBe('2026-06-01T10:00:00.000Z');
    expect(() => AllergyTransparencyLogSchema.parse(log)).not.toThrow();
  });

  it('returns event_count 0 and an empty events array for a household with no events', async () => {
    const svc = new AllergyTransparencyService(repoReturning([]));

    const log = await svc.exportAsJson(HOUSEHOLD_ID);

    expect(log.household_id).toBe(HOUSEHOLD_ID);
    expect(log.event_count).toBe(0);
    expect(log.events).toEqual([]);
  });

  it('counts every returned event', async () => {
    const svc = new AllergyTransparencyService(
      repoReturning([
        row({ id: '33333333-3333-4333-8333-333333333333' }),
        row({ id: '44444444-4444-4444-8444-444444444444' }),
      ]),
    );

    const log = await svc.exportAsJson(HOUSEHOLD_ID);

    expect(log.event_count).toBe(2);
  });
});

describe('AllergyTransparencyService.exportAsPdf', () => {
  it('returns a readable PDF stream with content for a non-empty log', async () => {
    const svc = new AllergyTransparencyService(
      repoReturning([row({ metadata: { conflicts: ['peanut'] } })]),
    );

    const stream = await svc.exportAsPdf(HOUSEHOLD_ID);
    const buffer = await collect(stream);

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('returns a one-page PDF stream for an empty log (never throws)', async () => {
    const svc = new AllergyTransparencyService(repoReturning([]));

    const stream = await svc.exportAsPdf(HOUSEHOLD_ID);
    const buffer = await collect(stream);

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});
