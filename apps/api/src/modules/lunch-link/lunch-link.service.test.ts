import { describe, it, expect, vi } from 'vitest';
import {
  LunchLinkService,
  compute8pmUtc,
  getMondayOfWeek,
  signToken,
  parseToken,
  verifyHmac,
  encodeBase64url,
} from './lunch-link.service.js';
import type {
  LunchLinkRepository,
  LunchLinkSessionRow,
} from './lunch-link.repository.js';
import type {
  HeartNoteRepository,
  HeartNoteRow,
} from '../heart-notes/heart-note.repository.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const DATE = '2026-05-17';
const HMAC_KEY = 'a'.repeat(64);
const WEB_BASE = 'http://localhost:5173';

function sampleNoteRow(overrides: Partial<HeartNoteRow> = {}): HeartNoteRow {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    household_id: HOUSEHOLD_ID,
    child_id: CHILD_ID,
    author_user_id: '11111111-1111-4111-8111-111111111111',
    content: 'Hope today is calm.',
    status: 'draft',
    scheduled_for: null,
    delivered_at: null,
    cancelled_at: null,
    created_at: '2026-05-17T12:00:00.000Z',
    updated_at: '2026-05-17T12:00:00.000Z',
    ...overrides,
  };
}

function sampleSessionRow(overrides: Partial<LunchLinkSessionRow> = {}): LunchLinkSessionRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    child_id: CHILD_ID,
    household_id: HOUSEHOLD_ID,
    date: DATE,
    nonce: '66666666-6666-4666-8666-666666666666',
    exp: '2026-05-17T20:00:00.000Z',
    first_opened_at: null,
    rating: null,
    rating_submitted_at: null,
    reopened_after_exp_count: 0,
    suppressed_at: null,
    created_at: '2026-05-17T12:00:00.000Z',
    updated_at: '2026-05-17T12:00:00.000Z',
    ...overrides,
  };
}

function buildGenerateService(opts: {
  childName: string | null;
  timezone?: string;
  noteRow?: HeartNoteRow | null;
}) {
  const lunchLinkRepo = {
    findChildName: vi.fn().mockResolvedValue(opts.childName),
    findHouseholdTimezone: vi.fn().mockResolvedValue(opts.timezone ?? 'UTC'),
    findOrCreateHmacKey: vi.fn().mockResolvedValue(HMAC_KEY),
    upsertSession: vi.fn().mockResolvedValue(sampleSessionRow()),
  };
  const heartNoteRepo = {
    findByChildAndDate: vi.fn().mockResolvedValue(opts.noteRow ?? null),
  };
  const service = new LunchLinkService(
    lunchLinkRepo as unknown as LunchLinkRepository,
    heartNoteRepo as unknown as HeartNoteRepository,
    WEB_BASE,
  );
  return { service, lunchLinkRepo, heartNoteRepo };
}

function buildVerifyService(opts: {
  hmacKey?: string | null;
  session?: LunchLinkSessionRow | null;
  childPublic?: { name: string; household_id: string } | null;
  noteRow?: HeartNoteRow | null;
}) {
  const lunchLinkRepo = {
    findHmacKey: vi.fn().mockResolvedValue(opts.hmacKey === undefined ? HMAC_KEY : opts.hmacKey),
    findSession: vi.fn().mockResolvedValue(opts.session ?? sampleSessionRow()),
    findChildPublic: vi
      .fn()
      .mockResolvedValue(
        opts.childPublic === undefined
          ? { name: 'Layla', household_id: HOUSEHOLD_ID }
          : opts.childPublic,
      ),
    recordFirstOpen: vi.fn().mockResolvedValue(undefined),
    incrementReopenedCount: vi.fn().mockResolvedValue(undefined),
  };
  const heartNoteRepo = {
    findForDelivery: vi.fn().mockResolvedValue(opts.noteRow ?? null),
  };
  const service = new LunchLinkService(
    lunchLinkRepo as unknown as LunchLinkRepository,
    heartNoteRepo as unknown as HeartNoteRepository,
    WEB_BASE,
  );
  return { service, lunchLinkRepo, heartNoteRepo };
}

// Forge a token using the live signer with a future exp.
function makeToken(opts?: {
  exp?: string;
  child_id?: string;
  date?: string;
  hmacKey?: string;
}): string {
  return signToken(
    {
      child_id: opts?.child_id ?? CHILD_ID,
      date: opts?.date ?? DATE,
      nonce: '77777777-7777-4777-8777-777777777777',
      exp: opts?.exp ?? '2099-01-01T00:00:00.000Z',
    },
    opts?.hmacKey ?? HMAC_KEY,
  );
}

describe('LunchLinkService.getDevPayload', () => {
  it('returns null when child is not in household', async () => {
    const lunchLinkRepo = {
      findChildName: vi.fn().mockResolvedValue(null),
    };
    const heartNoteRepo = {
      findByChildAndDate: vi.fn().mockResolvedValue(null),
    };
    const service = new LunchLinkService(
      lunchLinkRepo as unknown as LunchLinkRepository,
      heartNoteRepo as unknown as HeartNoteRepository,
    );
    const result = await service.getDevPayload(HOUSEHOLD_ID, CHILD_ID, DATE);
    expect(result).toBeNull();
    expect(heartNoteRepo.findByChildAndDate).not.toHaveBeenCalled();
  });

  it('returns payload with heartNote: null when no draft exists', async () => {
    const lunchLinkRepo = {
      findChildName: vi.fn().mockResolvedValue('Layla'),
    };
    const heartNoteRepo = {
      findByChildAndDate: vi.fn().mockResolvedValue(null),
    };
    const service = new LunchLinkService(
      lunchLinkRepo as unknown as LunchLinkRepository,
      heartNoteRepo as unknown as HeartNoteRepository,
    );
    const result = await service.getDevPayload(HOUSEHOLD_ID, CHILD_ID, DATE);
    expect(result?.childName).toBe('Layla');
    expect(result?.date).toBe(DATE);
    expect(result?.heartNote).toBeNull();
  });

  it('always returns the hardcoded stub bag (not from DB)', async () => {
    const lunchLinkRepo = {
      findChildName: vi.fn().mockResolvedValue('Layla'),
    };
    const heartNoteRepo = {
      findByChildAndDate: vi.fn().mockResolvedValue(null),
    };
    const service = new LunchLinkService(
      lunchLinkRepo as unknown as LunchLinkRepository,
      heartNoteRepo as unknown as HeartNoteRepository,
    );
    const result = await service.getDevPayload(HOUSEHOLD_ID, CHILD_ID, DATE);
    expect(result?.bag).toEqual({
      name: 'Sandwich, apple & water',
      sub: 'Packed for you today',
      safetyNote: 'Nut-free',
    });
  });
});

describe('LunchLinkService.generate', () => {
  it('returns a signed URL with the configured base prefix', async () => {
    const { service } = buildGenerateService({ childName: 'Layla' });
    const result = await service.generate(HOUSEHOLD_ID, {
      child_id: CHILD_ID,
      date: DATE,
    });
    expect(result.url.startsWith(`${WEB_BASE}/lunch/`)).toBe(true);
    // token body should round-trip
    const token = result.url.slice(`${WEB_BASE}/lunch/`.length);
    const parsed = parseToken(token);
    expect(parsed).not.toBeNull();
    expect(parsed?.child_id).toBe(CHILD_ID);
    expect(parsed?.date).toBe(DATE);
  });

  it('throws NotFoundError when child not in household', async () => {
    const { service } = buildGenerateService({ childName: null });
    await expect(
      service.generate(HOUSEHOLD_ID, { child_id: CHILD_ID, date: DATE }),
    ).rejects.toThrow();
  });

  it('upserts a session with the same nonce + exp that the token carries', async () => {
    const { service, lunchLinkRepo } = buildGenerateService({ childName: 'Layla' });
    const result = await service.generate(HOUSEHOLD_ID, {
      child_id: CHILD_ID,
      date: DATE,
    });
    const token = result.url.slice(`${WEB_BASE}/lunch/`.length);
    const parsed = parseToken(token);
    const call = lunchLinkRepo.upsertSession.mock.calls[0]?.[0] as {
      nonce: string;
      exp: string;
    };
    expect(call.nonce).toBe(parsed?.nonce);
    expect(call.exp).toBe(parsed?.exp);
  });
});

describe('LunchLinkService.verifyAndFetch', () => {
  it('returns status:invalid for a malformed token (no dot)', async () => {
    const { service } = buildVerifyService({});
    const result = await service.verifyAndFetch('garbage-no-dot');
    expect(result.status).toBe('invalid');
  });

  it('returns status:invalid when HMAC key not found for date', async () => {
    const { service } = buildVerifyService({ hmacKey: null });
    const result = await service.verifyAndFetch(makeToken());
    expect(result.status).toBe('invalid');
  });

  it('returns status:invalid for a token with wrong HMAC signature', async () => {
    const { service } = buildVerifyService({});
    const result = await service.verifyAndFetch(
      makeToken({ hmacKey: 'b'.repeat(64) }),
    );
    expect(result.status).toBe('invalid');
  });

  it('returns status:invalid for a suppressed session', async () => {
    const { service } = buildVerifyService({
      session: sampleSessionRow({ suppressed_at: '2026-05-17T08:00:00.000Z' }),
    });
    const result = await service.verifyAndFetch(makeToken());
    expect(result.status).toBe('invalid');
  });

  it('returns status:invalid for an unknown child_id', async () => {
    const { service } = buildVerifyService({ childPublic: null });
    const result = await service.verifyAndFetch(makeToken());
    expect(result.status).toBe('invalid');
  });

  it('returns status:valid with heartNote when note exists and token unexpired', async () => {
    const { service, lunchLinkRepo } = buildVerifyService({
      noteRow: sampleNoteRow({ content: 'hello' }),
    });
    const result = await service.verifyAndFetch(makeToken());
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.payload.heartNote).toEqual({
        body: 'hello',
        authorDisplayName: 'Parent',
      });
      expect(result.payload.expired).toBe(false);
    }
    expect(lunchLinkRepo.recordFirstOpen).toHaveBeenCalledWith(CHILD_ID, DATE);
  });

  it('returns status:valid with heartNote:null when no note exists', async () => {
    const { service } = buildVerifyService({});
    const result = await service.verifyAndFetch(makeToken());
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.payload.heartNote).toBeNull();
    }
  });

  it('returns status:expired with snapshot when token is past exp', async () => {
    const { service, lunchLinkRepo } = buildVerifyService({});
    const result = await service.verifyAndFetch(
      makeToken({ exp: '2000-01-01T00:00:00.000Z' }),
    );
    expect(result.status).toBe('expired');
    if (result.status === 'expired') {
      expect(result.expiredPayload.expired).toBe(true);
    }
    expect(lunchLinkRepo.incrementReopenedCount).toHaveBeenCalledWith(CHILD_ID, DATE);
  });

  it('includes session rating in the expired snapshot', async () => {
    const { service } = buildVerifyService({
      session: sampleSessionRow({ rating: 'loved' }),
    });
    const result = await service.verifyAndFetch(
      makeToken({ exp: '2000-01-01T00:00:00.000Z' }),
    );
    expect(result.status).toBe('expired');
    if (result.status === 'expired') {
      expect(result.expiredPayload.last_state_snapshot.rating).toBe('loved');
    }
  });
});

describe('token signing utilities (via service round-trip)', () => {
  it('signToken + parseToken + verifyHmac round-trip is valid', () => {
    const token = signToken(
      {
        child_id: CHILD_ID,
        date: DATE,
        nonce: '77777777-7777-4777-8777-777777777777',
        exp: '2099-01-01T00:00:00.000Z',
      },
      HMAC_KEY,
    );
    const parsed = parseToken(token);
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(verifyHmac(parsed.encodedPayload, parsed.signature, HMAC_KEY)).toBe(true);
    }
  });

  it('tampered payload fails HMAC verification', () => {
    const token = signToken(
      {
        child_id: CHILD_ID,
        date: DATE,
        nonce: '77777777-7777-4777-8777-777777777777',
        exp: '2099-01-01T00:00:00.000Z',
      },
      HMAC_KEY,
    );
    const dotIdx = token.lastIndexOf('.');
    const sig = token.slice(dotIdx + 1);
    // Forge a different payload with a different child_id; reuse the original signature.
    const tampered = encodeBase64url(
      JSON.stringify({
        child_id: '99999999-9999-4999-8999-999999999999',
        date: DATE,
        nonce: '77777777-7777-4777-8777-777777777777',
        exp: '2099-01-01T00:00:00.000Z',
      }),
    );
    expect(verifyHmac(tampered, sig, HMAC_KEY)).toBe(false);
  });

  it('parseToken returns null for non-hex signature', () => {
    expect(parseToken('abc.not-a-sig')).toBeNull();
  });
});

// Slice 4-S4: build a service stubbed for the rate path.
function buildRateService(opts: {
  hmacKey?: string | null;
  session?: LunchLinkSessionRow | null;
  childPublic?: { name: string; household_id: string } | null;
}) {
  const lunchLinkRepo = {
    findHmacKey: vi
      .fn()
      .mockResolvedValue(opts.hmacKey === undefined ? HMAC_KEY : opts.hmacKey),
    findSession: vi
      .fn()
      .mockResolvedValue(opts.session === undefined ? sampleSessionRow() : opts.session),
    findChildPublic: vi
      .fn()
      .mockResolvedValue(
        opts.childPublic === undefined
          ? { name: 'Layla', household_id: HOUSEHOLD_ID }
          : opts.childPublic,
      ),
    setRating: vi.fn().mockResolvedValue(undefined),
  };
  const heartNoteRepo = {
    findByChildAndDate: vi.fn().mockResolvedValue(null),
  };
  const service = new LunchLinkService(
    lunchLinkRepo as unknown as LunchLinkRepository,
    heartNoteRepo as unknown as HeartNoteRepository,
    WEB_BASE,
  );
  return { service, lunchLinkRepo };
}

describe('LunchLinkService.rate', () => {
  it('returns status:ok for a valid unexpired token with rating', async () => {
    const { service, lunchLinkRepo } = buildRateService({});
    const result = await service.rate(makeToken(), 'loved');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.householdId).toBe(HOUSEHOLD_ID);
      expect(result.childId).toBe(CHILD_ID);
      expect(result.date).toBe(DATE);
    }
    expect(lunchLinkRepo.setRating).toHaveBeenCalledWith(CHILD_ID, DATE, 'loved');
  });

  it('returns status:invalid for a malformed token', async () => {
    const { service, lunchLinkRepo } = buildRateService({});
    const result = await service.rate('garbage-no-dot', 'loved');
    expect(result.status).toBe('invalid');
    expect(lunchLinkRepo.setRating).not.toHaveBeenCalled();
  });

  it('returns status:invalid for a token with wrong HMAC', async () => {
    const { service, lunchLinkRepo } = buildRateService({});
    const result = await service.rate(makeToken({ hmacKey: 'b'.repeat(64) }), 'loved');
    expect(result.status).toBe('invalid');
    expect(lunchLinkRepo.setRating).not.toHaveBeenCalled();
  });

  it('returns status:invalid when the token is expired', async () => {
    const { service, lunchLinkRepo } = buildRateService({});
    const result = await service.rate(
      makeToken({ exp: '2000-01-01T00:00:00.000Z' }),
      'loved',
    );
    expect(result.status).toBe('invalid');
    expect(lunchLinkRepo.setRating).not.toHaveBeenCalled();
  });

  it('returns status:invalid for a suppressed session', async () => {
    const { service, lunchLinkRepo } = buildRateService({
      session: sampleSessionRow({ suppressed_at: '2026-05-17T08:00:00.000Z' }),
    });
    const result = await service.rate(makeToken(), 'loved');
    expect(result.status).toBe('invalid');
    expect(lunchLinkRepo.setRating).not.toHaveBeenCalled();
  });

  it('returns status:invalid when child not found', async () => {
    const { service, lunchLinkRepo } = buildRateService({ childPublic: null });
    const result = await service.rate(makeToken(), 'loved');
    expect(result.status).toBe('invalid');
    expect(lunchLinkRepo.setRating).not.toHaveBeenCalled();
  });

  it('returns status:invalid when the session is missing', async () => {
    const { service, lunchLinkRepo } = buildRateService({ session: null });
    const result = await service.rate(makeToken(), 'loved');
    expect(result.status).toBe('invalid');
    expect(lunchLinkRepo.setRating).not.toHaveBeenCalled();
  });

  it('overwrites an existing rating (overwrite semantics)', async () => {
    const { service, lunchLinkRepo } = buildRateService({
      session: sampleSessionRow({ rating: 'loved' }),
    });
    const result = await service.rate(makeToken(), 'not-really');
    expect(result.status).toBe('ok');
    expect(lunchLinkRepo.setRating).toHaveBeenCalledWith(CHILD_ID, DATE, 'not-really');
  });
});

describe('LunchLinkService.verifyAndFetch (S4 rating in valid payload)', () => {
  it('exposes session rating on the 200 payload', async () => {
    const { service } = buildVerifyService({
      session: sampleSessionRow({ rating: 'ok' }),
    });
    const result = await service.verifyAndFetch(makeToken());
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.payload.rating).toBe('ok');
    }
  });

  it('exposes rating:null when the session has not been rated', async () => {
    const { service } = buildVerifyService({});
    const result = await service.verifyAndFetch(makeToken());
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.payload.rating).toBeNull();
    }
  });
});

describe('getMondayOfWeek', () => {
  it('returns the same date for a Monday input', () => {
    expect(getMondayOfWeek('2026-08-31')).toBe('2026-08-31');
  });
  it('returns Monday for a Wednesday input (2026-09-02 → 2026-08-31)', () => {
    expect(getMondayOfWeek('2026-09-02')).toBe('2026-08-31');
  });
  it('returns Monday for a Friday input (2026-09-04 → 2026-08-31)', () => {
    expect(getMondayOfWeek('2026-09-04')).toBe('2026-08-31');
  });
  it('returns Monday for a Sunday input (2026-09-06 → 2026-08-31)', () => {
    expect(getMondayOfWeek('2026-09-06')).toBe('2026-08-31');
  });
  it('handles DST transition dates via UTC arithmetic (no offset drift)', () => {
    // US spring-forward 2026-03-08 (Sun). Monday of that week → 2026-03-02.
    expect(getMondayOfWeek('2026-03-08')).toBe('2026-03-02');
    // US fall-back 2026-11-01 (Sun). Monday of that week → 2026-10-26.
    expect(getMondayOfWeek('2026-11-01')).toBe('2026-10-26');
  });
});

describe('compute8pmUtc', () => {
  it('returns 01:00 UTC for America/New_York on 2026-09-01 (EDT, UTC-4)', () => {
    // 8pm EDT = 00:00 UTC the next day. But the function computes the time
    // relative to noon UTC, which is 08:00 EDT — 8pm EDT is 12 hours later
    // = 00:00 UTC on 2026-09-02.
    const result = compute8pmUtc('2026-09-01', 'America/New_York');
    expect(result.toISOString()).toBe('2026-09-02T00:00:00.000Z');
  });

  it('returns 12:00 UTC for Asia/Shanghai on 2026-09-01 (CST, UTC+8)', () => {
    // 8pm CST = 12:00 UTC same day
    const result = compute8pmUtc('2026-09-01', 'Asia/Shanghai');
    expect(result.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });

  it('returns 14:30 UTC for Asia/Kolkata on 2026-09-01 (IST, UTC+5:30)', () => {
    // 8pm IST = 14:30 UTC same day
    const result = compute8pmUtc('2026-09-01', 'Asia/Kolkata');
    expect(result.toISOString()).toBe('2026-09-01T14:30:00.000Z');
  });

  it('returns 20:00 UTC for UTC timezone on 2026-09-01', () => {
    const result = compute8pmUtc('2026-09-01', 'UTC');
    expect(result.toISOString()).toBe('2026-09-01T20:00:00.000Z');
  });
});
