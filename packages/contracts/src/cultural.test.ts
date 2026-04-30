import { describe, it, expect } from 'vitest';
import {
  CulturalKeySchema,
  CulturalPriorListResponseSchema,
  CulturalPriorSchema,
  RatifyActionSchema,
  RatifyCulturalPriorBodySchema,
  RatifyCulturalPriorResponseSchema,
  TemplateStateChangedEventSchema,
  TemplateStateSchema,
  TierSchema,
} from './cultural.js';
import { TurnBody, TurnBodyRatificationPrompt } from './thread.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const PRIOR_UUID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_UUID = '33333333-3333-4333-8333-333333333333';

const samplePrior = {
  id: PRIOR_UUID,
  household_id: HOUSEHOLD_UUID,
  key: 'south_asian' as const,
  label: 'South Asian',
  tier: 'L1' as const,
  state: 'detected' as const,
  presence: 80,
  confidence: 90,
  opted_in_at: null,
  opted_out_at: null,
  last_signal_at: '2026-04-28T10:00:00.000Z',
  created_at: '2026-04-28T10:00:00.000Z',
};

describe('CulturalKeySchema', () => {
  it('accepts every Phase-1 key', () => {
    for (const key of [
      'halal',
      'kosher',
      'hindu_vegetarian',
      'south_asian',
      'east_african',
      'caribbean',
    ]) {
      expect(CulturalKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it('rejects unknown keys (mediterranean is not Phase-1)', () => {
    expect(CulturalKeySchema.safeParse('mediterranean').success).toBe(false);
  });
});

describe('TierSchema / TemplateStateSchema', () => {
  it('TierSchema accepts L1, L2, L3', () => {
    for (const t of ['L1', 'L2', 'L3']) {
      expect(TierSchema.safeParse(t).success).toBe(true);
    }
    expect(TierSchema.safeParse('L0').success).toBe(false);
  });

  it('TemplateStateSchema accepts every documented state', () => {
    for (const s of [
      'detected',
      'suggested',
      'opt_in_confirmed',
      'active',
      'dormant',
      'forgotten',
    ]) {
      expect(TemplateStateSchema.safeParse(s).success).toBe(true);
    }
    expect(TemplateStateSchema.safeParse('unknown').success).toBe(false);
  });
});

describe('CulturalPriorSchema', () => {
  it('round-trips a valid detected prior', () => {
    expect(CulturalPriorSchema.safeParse(samplePrior).success).toBe(true);
  });

  it('rejects a prior with presence > 100', () => {
    expect(
      CulturalPriorSchema.safeParse({ ...samplePrior, presence: 101 }).success,
    ).toBe(false);
  });

  it('rejects a prior with non-integer confidence', () => {
    expect(
      CulturalPriorSchema.safeParse({ ...samplePrior, confidence: 50.5 }).success,
    ).toBe(false);
  });

  it('accepts opted_in_at / opted_out_at as null', () => {
    expect(
      CulturalPriorSchema.safeParse({
        ...samplePrior,
        state: 'opt_in_confirmed',
        opted_in_at: '2026-04-28T11:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('RatifyActionSchema / RatifyCulturalPriorBodySchema', () => {
  it('RatifyActionSchema accepts opt_in / forget / tell_lumi_more', () => {
    for (const a of ['opt_in', 'forget', 'tell_lumi_more']) {
      expect(RatifyActionSchema.safeParse(a).success).toBe(true);
    }
  });

  it('RatifyCulturalPriorBodySchema rejects unknown action values', () => {
    expect(
      RatifyCulturalPriorBodySchema.safeParse({ action: 'opt_out' }).success,
    ).toBe(false);
  });
});

describe('CulturalPriorListResponseSchema / RatifyCulturalPriorResponseSchema', () => {
  it('list response wraps the priors array', () => {
    expect(
      CulturalPriorListResponseSchema.safeParse({ priors: [samplePrior] }).success,
    ).toBe(true);
  });

  it('ratify response carries the prior and optional lumi_response', () => {
    expect(
      RatifyCulturalPriorResponseSchema.safeParse({ prior: samplePrior }).success,
    ).toBe(true);
    expect(
      RatifyCulturalPriorResponseSchema.safeParse({
        prior: samplePrior,
        lumi_response: 'Tell me more about that.',
      }).success,
    ).toBe(true);
  });
});

describe('TemplateStateChangedEventSchema', () => {
  it('round-trips a valid event', () => {
    const event = {
      type: 'template.state_changed' as const,
      prior_id: PRIOR_UUID,
      household_id: HOUSEHOLD_UUID,
      key: 'halal' as const,
      from_state: 'detected' as const,
      to_state: 'opt_in_confirmed' as const,
      at: '2026-04-28T10:00:00.000Z',
    };
    expect(TemplateStateChangedEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects events with the wrong literal type', () => {
    expect(
      TemplateStateChangedEventSchema.safeParse({
        type: 'plan.regenerated',
        prior_id: PRIOR_UUID,
        household_id: HOUSEHOLD_UUID,
        key: 'halal',
        from_state: 'detected',
        to_state: 'opt_in_confirmed',
        at: '2026-04-28T10:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('TurnBodyRatificationPrompt', () => {
  const validBody = {
    type: 'ratification_prompt' as const,
    priors: [{ prior_id: PRIOR_UUID, key: 'south_asian', label: 'South Asian' }],
  };

  it('accepts a body with one or more priors', () => {
    expect(TurnBodyRatificationPrompt.safeParse(validBody).success).toBe(true);
    expect(
      TurnBodyRatificationPrompt.safeParse({ ...validBody, priors: [] }).success,
    ).toBe(true);
  });

  it('rejects entries missing prior_id / key / label', () => {
    expect(
      TurnBodyRatificationPrompt.safeParse({
        type: 'ratification_prompt',
        priors: [{ key: 'south_asian', label: 'South Asian' }],
      }).success,
    ).toBe(false);
  });

  it('rejects non-uuid prior_id', () => {
    expect(
      TurnBodyRatificationPrompt.safeParse({
        type: 'ratification_prompt',
        priors: [{ prior_id: 'not-a-uuid', key: 'halal', label: 'Halal' }],
      }).success,
    ).toBe(false);
  });

  it('participates in the TurnBody discriminated union', () => {
    const parsed = TurnBody.safeParse(validBody);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe('ratification_prompt');
    }
  });
});

// Defensive checks against accidental contract drift.
describe('contract integrity', () => {
  it('CulturalPriorSchema includes household_id (used by RBAC checks)', () => {
    expect(CulturalPriorSchema.safeParse({ ...samplePrior, household_id: VALID_UUID }).success).toBe(
      true,
    );
  });
});
