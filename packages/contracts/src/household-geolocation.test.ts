import { describe, expect, it } from 'vitest';
import {
  HouseholdGeolocationConsentSchema,
  UpdateGeolocationConsentRequestSchema,
} from './household-geolocation.js';

describe('HouseholdGeolocationConsentSchema', () => {
  it('parses enabled state', () => {
    const result = HouseholdGeolocationConsentSchema.parse({
      geolocation_enabled: true,
      geolocation_consented_at: '2026-10-22T10:00:00.000Z',
      geolocation_purpose: 'cultural_supplier_routing',
    });
    expect(result.geolocation_enabled).toBe(true);
    expect(result.geolocation_purpose).toBe('cultural_supplier_routing');
  });

  it('parses disabled state with nulls', () => {
    const result = HouseholdGeolocationConsentSchema.parse({
      geolocation_enabled: false,
      geolocation_consented_at: null,
      geolocation_purpose: null,
    });
    expect(result.geolocation_enabled).toBe(false);
    expect(result.geolocation_consented_at).toBeNull();
    expect(result.geolocation_purpose).toBeNull();
  });

  it('rejects an unknown geolocation_purpose', () => {
    expect(() =>
      HouseholdGeolocationConsentSchema.parse({
        geolocation_enabled: true,
        geolocation_consented_at: null,
        geolocation_purpose: 'targeted_advertising',
      }),
    ).toThrow();
  });
});

describe('UpdateGeolocationConsentRequestSchema', () => {
  it('accepts enable with purpose', () => {
    const result = UpdateGeolocationConsentRequestSchema.parse({
      geolocation_enabled: true,
      geolocation_purpose: 'cultural_supplier_routing',
    });
    expect(result.geolocation_enabled).toBe(true);
  });

  it('rejects enable without purpose', () => {
    expect(() =>
      UpdateGeolocationConsentRequestSchema.parse({ geolocation_enabled: true }),
    ).toThrow();
  });

  it('accepts disable without purpose', () => {
    const result = UpdateGeolocationConsentRequestSchema.parse({ geolocation_enabled: false });
    expect(result.geolocation_enabled).toBe(false);
  });
});
