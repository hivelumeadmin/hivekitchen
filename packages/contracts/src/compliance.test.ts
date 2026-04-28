import { describe, it, expect } from 'vitest';
import {
  AcknowledgeParentalNoticeRequestSchema,
  AcknowledgeParentalNoticeResponseSchema,
  ConsentDeclarationResponseSchema,
  ParentalNoticeResponseSchema,
  ProcessorEntrySchema,
  RetentionEntrySchema,
  VpcConsentRequestSchema,
  VpcConsentResponseSchema,
} from './compliance.js';

describe('VpcConsentRequestSchema', () => {
  it("accepts { document_version: 'v1' }", () => {
    expect(VpcConsentRequestSchema.safeParse({ document_version: 'v1' }).success).toBe(true);
  });

  it('rejects when document_version is missing', () => {
    expect(VpcConsentRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an unknown document_version ('v99')", () => {
    expect(VpcConsentRequestSchema.safeParse({ document_version: 'v99' }).success).toBe(false);
  });
});

describe('VpcConsentResponseSchema', () => {
  const valid = {
    household_id: '11111111-1111-4111-8111-111111111111',
    signed_at: '2026-04-27T12:00:00.000Z',
    mechanism: 'soft_signed_declaration' as const,
    document_version: 'v1',
  };

  it('accepts a valid shaped object', () => {
    expect(VpcConsentResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a non-uuid household_id', () => {
    expect(
      VpcConsentResponseSchema.safeParse({ ...valid, household_id: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects an invalid signed_at datetime', () => {
    expect(
      VpcConsentResponseSchema.safeParse({ ...valid, signed_at: 'yesterday' }).success,
    ).toBe(false);
  });

  it("rejects mechanism other than 'soft_signed_declaration'", () => {
    expect(
      VpcConsentResponseSchema.safeParse({ ...valid, mechanism: 'credit_card_vpc' }).success,
    ).toBe(false);
  });
});

describe('ConsentDeclarationResponseSchema', () => {
  it('accepts a valid object', () => {
    expect(
      ConsentDeclarationResponseSchema.safeParse({
        document_version: 'v1',
        content: '# Declaration\n\nText here.',
      }).success,
    ).toBe(true);
  });

  it('rejects when content is missing', () => {
    expect(
      ConsentDeclarationResponseSchema.safeParse({ document_version: 'v1' }).success,
    ).toBe(false);
  });
});

// ---- Story 2.9: parental notice ------------------------------------------

describe('ProcessorEntrySchema', () => {
  const valid = {
    name: 'supabase' as const,
    display_name: 'Supabase',
    purpose: 'Primary database.',
    data_categories: ['household profile'],
    retention_label: 'Active-account lifetime.',
  };

  it('accepts a valid processor entry', () => {
    expect(ProcessorEntrySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an unknown processor name", () => {
    expect(
      ProcessorEntrySchema.safeParse({ ...valid, name: 'aws' }).success,
    ).toBe(false);
  });

  it('rejects empty data_categories', () => {
    expect(
      ProcessorEntrySchema.safeParse({ ...valid, data_categories: [] }).success,
    ).toBe(false);
  });

  it('rejects empty display_name', () => {
    expect(ProcessorEntrySchema.safeParse({ ...valid, display_name: '' }).success).toBe(false);
  });

  it('rejects empty purpose', () => {
    expect(ProcessorEntrySchema.safeParse({ ...valid, purpose: '' }).success).toBe(false);
  });

  it('rejects empty retention_label', () => {
    expect(ProcessorEntrySchema.safeParse({ ...valid, retention_label: '' }).success).toBe(false);
  });
});

describe('AcknowledgeParentalNoticeRequestSchema', () => {
  it("accepts { document_version: 'v1' }", () => {
    expect(
      AcknowledgeParentalNoticeRequestSchema.safeParse({ document_version: 'v1' }).success,
    ).toBe(true);
  });

  it('rejects when document_version is missing', () => {
    expect(AcknowledgeParentalNoticeRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an unknown document_version ('v2')", () => {
    expect(
      AcknowledgeParentalNoticeRequestSchema.safeParse({ document_version: 'v2' }).success,
    ).toBe(false);
  });
});

describe('AcknowledgeParentalNoticeResponseSchema', () => {
  it('accepts a valid object', () => {
    expect(
      AcknowledgeParentalNoticeResponseSchema.safeParse({
        acknowledged_at: '2026-04-27T12:00:00.000Z',
        document_version: 'v1',
      }).success,
    ).toBe(true);
  });

  it('rejects an invalid acknowledged_at datetime', () => {
    expect(
      AcknowledgeParentalNoticeResponseSchema.safeParse({
        acknowledged_at: 'tomorrow',
        document_version: 'v1',
      }).success,
    ).toBe(false);
  });

  it('rejects when acknowledged_at is missing', () => {
    expect(
      AcknowledgeParentalNoticeResponseSchema.safeParse({ document_version: 'v1' }).success,
    ).toBe(false);
  });

  it('rejects when document_version is missing', () => {
    expect(
      AcknowledgeParentalNoticeResponseSchema.safeParse({
        acknowledged_at: '2026-04-27T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('ParentalNoticeResponseSchema', () => {
  function buildProcessor(name: string): unknown {
    return {
      name,
      display_name: name,
      purpose: 'p',
      data_categories: ['c'],
      retention_label: 'r',
    };
  }

  const sixProcessors = [
    buildProcessor('supabase'),
    buildProcessor('elevenlabs'),
    buildProcessor('sendgrid'),
    buildProcessor('twilio'),
    buildProcessor('stripe'),
    buildProcessor('openai'),
  ];

  const valid = {
    document_version: 'v1',
    content: '# Notice\n\nText.',
    processors: sixProcessors,
    data_categories: ['household profile'],
    retention: [{ category: 'voice', horizon_days: 90, label: '90 days' }],
  };

  it('accepts a fully-shaped notice with all six processors', () => {
    expect(ParentalNoticeResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects when fewer than six processors are listed', () => {
    expect(
      ParentalNoticeResponseSchema.safeParse({
        ...valid,
        processors: sixProcessors.slice(0, 5),
      }).success,
    ).toBe(false);
  });

  it('rejects when more than six processors are listed', () => {
    expect(
      ParentalNoticeResponseSchema.safeParse({
        ...valid,
        processors: [...sixProcessors, buildProcessor('supabase')],
      }).success,
    ).toBe(false);
  });

  it('rejects when content is empty', () => {
    expect(
      ParentalNoticeResponseSchema.safeParse({ ...valid, content: '' }).success,
    ).toBe(false);
  });

  it('accepts retention with horizon_days null (account-lifetime)', () => {
    expect(
      ParentalNoticeResponseSchema.safeParse({
        ...valid,
        retention: [{ category: 'plans', horizon_days: null, label: 'lifetime' }],
      }).success,
    ).toBe(true);
  });

  it('rejects when data_categories is an empty array', () => {
    expect(
      ParentalNoticeResponseSchema.safeParse({ ...valid, data_categories: [] }).success,
    ).toBe(false);
  });

  it('rejects when retention is an empty array', () => {
    expect(
      ParentalNoticeResponseSchema.safeParse({ ...valid, retention: [] }).success,
    ).toBe(false);
  });

  it('rejects when processor names are duplicated', () => {
    const withDuplicate = [
      ...sixProcessors.slice(0, 5),
      buildProcessor('supabase'), // second supabase, no openai
    ];
    expect(
      ParentalNoticeResponseSchema.safeParse({ ...valid, processors: withDuplicate }).success,
    ).toBe(false);
  });
});

describe('RetentionEntrySchema', () => {
  const valid = {
    category: 'voice transcripts',
    horizon_days: 90,
    label: '90 days',
  };

  it('accepts a valid retention entry', () => {
    expect(RetentionEntrySchema.safeParse(valid).success).toBe(true);
  });

  it('accepts horizon_days null (account-lifetime)', () => {
    expect(RetentionEntrySchema.safeParse({ ...valid, horizon_days: null }).success).toBe(true);
  });

  it('rejects negative horizon_days', () => {
    expect(RetentionEntrySchema.safeParse({ ...valid, horizon_days: -1 }).success).toBe(false);
  });

  it('rejects a non-integer horizon_days', () => {
    expect(RetentionEntrySchema.safeParse({ ...valid, horizon_days: 90.5 }).success).toBe(false);
  });

  it('rejects empty category', () => {
    expect(RetentionEntrySchema.safeParse({ ...valid, category: '' }).success).toBe(false);
  });

  it('rejects empty label', () => {
    expect(RetentionEntrySchema.safeParse({ ...valid, label: '' }).success).toBe(false);
  });
});
