import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CulturalCalendarService,
  type CulturalObservance,
  type CulturalTemplateKey,
} from './cultural-calendar.service.js';

interface QueryCapture {
  in: { column: string; values: unknown[] } | null;
  lte: { column: string; value: unknown } | null;
  gte: { column: string; value: unknown } | null;
}

function buildClient(opts: {
  rows: Array<Partial<CulturalObservance>>;
  error?: unknown;
  capture?: QueryCapture;
}): SupabaseClient {
  const result = { data: opts.rows, error: opts.error ?? null };
  const builder = {
    select: vi.fn().mockImplementation(() => builder),
    in: vi.fn().mockImplementation((column: string, values: unknown[]) => {
      if (opts.capture) opts.capture.in = { column, values };
      return builder;
    }),
    lte: vi.fn().mockImplementation((column: string, value: unknown) => {
      if (opts.capture) opts.capture.lte = { column, value };
      return builder;
    }),
    gte: vi.fn().mockImplementation((column: string, value: unknown) => {
      if (opts.capture) opts.capture.gte = { column, value };
      return Promise.resolve(result);
    }),
  };
  const from = vi.fn().mockReturnValue(builder);
  return { from } as unknown as SupabaseClient;
}

describe('CulturalCalendarService.getUpcomingObservances', () => {
  it('returns empty array when culturalTemplates is empty (silence mode)', async () => {
    const fromMock = vi.fn();
    const service = new CulturalCalendarService(
      { from: fromMock } as unknown as SupabaseClient,
    );

    const result = await service.getUpcomingObservances({
      weekOf: '2026-11-02',
      culturalTemplates: [],
    });

    expect(result).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('queries with overlap window [weekOf, weekOf + 6d] filtered by templates', async () => {
    const capture: QueryCapture = { in: null, lte: null, gte: null };
    const client = buildClient({ rows: [], capture });
    const service = new CulturalCalendarService(client);

    await service.getUpcomingObservances({
      weekOf: '2026-11-02',
      culturalTemplates: ['hindu_vegetarian'],
    });

    expect(capture.in).toEqual({
      column: 'cultural_template',
      values: ['hindu_vegetarian'],
    });
    expect(capture.lte).toEqual({ column: 'start_date', value: '2026-11-08' });
    expect(capture.gte).toEqual({ column: 'end_date', value: '2026-11-02' });
  });

  it('returns matching observances for the requested templates', async () => {
    const rows: Array<Partial<CulturalObservance>> = [
      {
        observance_name: 'Diwali',
        cultural_template: 'hindu_vegetarian',
        start_date: '2026-11-08',
        end_date: '2026-11-08',
        dietary_notes: 'Sweets and fried foods.',
      },
    ];
    const client = buildClient({ rows });
    const service = new CulturalCalendarService(client);

    const result = await service.getUpcomingObservances({
      weekOf: '2026-11-02',
      culturalTemplates: ['hindu_vegetarian'],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.observance_name).toBe('Diwali');
    expect(result[0]?.cultural_template).toBe('hindu_vegetarian');
  });

  it('normalises Shabbat year-spanning rows to the Friday of the plan week', async () => {
    const rows: Array<Partial<CulturalObservance>> = [
      {
        observance_name: 'Shabbat',
        cultural_template: 'kosher',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        dietary_notes: 'Friday dinner: challah, fish, chicken.',
      },
    ];
    const client = buildClient({ rows });
    const service = new CulturalCalendarService(client);

    const result = await service.getUpcomingObservances({
      weekOf: '2026-11-02', // Monday
      culturalTemplates: ['kosher'],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.start_date).toBe('2026-11-06'); // Friday of that week
    expect(result[0]?.end_date).toBe('2026-11-06');
  });

  it('throws when supabase returns an error', async () => {
    const client = buildClient({
      rows: [],
      error: { message: 'boom' },
    });
    const service = new CulturalCalendarService(client);

    await expect(
      service.getUpcomingObservances({
        weekOf: '2026-11-02',
        culturalTemplates: ['hindu_vegetarian'],
      }),
    ).rejects.toMatchObject({ message: 'boom' });
  });

  it('passes only the requested templates to the supabase filter', async () => {
    const capture: QueryCapture = { in: null, lte: null, gte: null };
    const client = buildClient({ rows: [], capture });
    const service = new CulturalCalendarService(client);
    const templates: CulturalTemplateKey[] = ['halal', 'kosher'];

    await service.getUpcomingObservances({
      weekOf: '2026-04-06',
      culturalTemplates: templates,
    });

    expect(capture.in?.values).toEqual(['halal', 'kosher']);
  });
});
