import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  GenerateLunchLinkBody,
  GenerateLunchLinkResponse,
  LunchLinkDevResponse,
  LunchLinkPayload,
  LunchLinkExpiredPayload,
} from '@hivekitchen/contracts';
import { NotFoundError } from '../../common/errors.js';
import type { LunchLinkRepository } from './lunch-link.repository.js';
import type { HeartNoteRepository } from '../heart-notes/heart-note.repository.js';

// Hardcoded stub bag — real bag from plan_slots + plan_slot_variations ships in a later slice.
const STUB_BAG = {
  name: 'Sandwich, apple & water',
  sub: 'Packed for you today',
  safetyNote: 'Nut-free',
} as const;

// Internal token payload — not exposed via the contracts package.
const TokenPayloadSchema = z.object({
  child_id: z.string().uuid(),
  date: z.string().date(),
  nonce: z.string().uuid(),
  exp: z.string().datetime({ offset: true }),
});
type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export function encodeBase64url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function signToken(payload: TokenPayload, hmacKeyHex: string): string {
  const encoded = encodeBase64url(JSON.stringify(payload));
  const sig = createHmac('sha256', Buffer.from(hmacKeyHex, 'hex'))
    .update(encoded)
    .digest('hex');
  return `${encoded}.${sig}`;
}

export function parseToken(
  rawToken: string,
):
  | (TokenPayload & { encodedPayload: string; signature: string })
  | null {
  const dotIdx = rawToken.lastIndexOf('.');
  if (dotIdx === -1) return null;
  const encodedPayload = rawToken.slice(0, dotIdx);
  const signature = rawToken.slice(dotIdx + 1);
  if (!/^[0-9a-f]{64}$/.test(signature)) return null;
  try {
    const json = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const parsed = TokenPayloadSchema.parse(JSON.parse(json));
    return { ...parsed, encodedPayload, signature };
  } catch {
    return null;
  }
}

export function verifyHmac(
  encodedPayload: string,
  providedSig: string,
  hmacKeyHex: string,
): boolean {
  const expected = createHmac('sha256', Buffer.from(hmacKeyHex, 'hex'))
    .update(encodedPayload)
    .digest('hex');
  try {
    const a = Buffer.from(providedSig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Slice 4-S4: Returns the Monday (YYYY-MM-DD) of the ISO week containing isoDate.
// UTC arithmetic avoids DST surprises — same convention as buildSuppressionMap
// in brief-state.composer. Exported so the routes plugin can reuse it for the
// briefStateComposer.refresh weekId argument.
export function getMondayOfWeek(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return d.toISOString().split('T')[0]!;
}

/** Returns a UTC Date representing 8pm in the given IANA timezone on isoDate.
 * Uses Intl.DateTimeFormat.formatToParts() at noon UTC and computes the local
 * hour/minute offset — correct across DST transitions. Not correct for
 * UTC+14 (Line Islands, ~2000 people). */
export function compute8pmUtc(isoDate: string, tz: string): Date {
  const noon = new Date(`${isoDate}T12:00:00Z`);

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(noon);
  } catch {
    // Invalid IANA timezone string — fall back to UTC (8pm UTC).
    return new Date(`${isoDate}T20:00:00Z`);
  }

  const pMap = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  // Intl renders midnight as either '00' or '24' depending on the locale; both
  // are valid integers, so parseInt copes.
  const localHour = parseInt(pMap['hour'] ?? '12', 10) % 24;
  const localMinute = parseInt(pMap['minute'] ?? '0', 10);

  const minutesFromNoonUtc = 20 * 60 - (localHour * 60 + localMinute);
  return new Date(noon.getTime() + minutesFromNoonUtc * 60 * 1000);
}

export type VerifyResult =
  | { status: 'invalid' }
  | { status: 'valid'; payload: LunchLinkPayload; householdId: string; childId: string }
  | {
      status: 'expired';
      expiredPayload: LunchLinkExpiredPayload;
      householdId: string;
      childId: string;
    };

export class LunchLinkService {
  constructor(
    private readonly lunchLinkRepo: LunchLinkRepository,
    private readonly heartNoteRepo: HeartNoteRepository,
    private readonly webBaseUrl?: string,
  ) {}

  async generate(
    householdId: string,
    body: GenerateLunchLinkBody,
  ): Promise<GenerateLunchLinkResponse> {
    if (this.webBaseUrl === undefined) {
      throw new Error('LunchLinkService.generate requires webBaseUrl');
    }
    const childName = await this.lunchLinkRepo.findChildName(
      body.child_id,
      householdId,
    );
    if (childName === null) throw new NotFoundError('Child not found');

    const tz = await this.lunchLinkRepo.findHouseholdTimezone(householdId);
    const exp = compute8pmUtc(body.date, tz);

    const hmacKey = await this.lunchLinkRepo.findOrCreateHmacKey(body.date);

    const nonce = randomUUID();
    const payload: TokenPayload = {
      child_id: body.child_id,
      date: body.date,
      nonce,
      exp: exp.toISOString(),
    };
    const token = signToken(payload, hmacKey);

    await this.lunchLinkRepo.upsertSession({
      childId: body.child_id,
      householdId,
      date: body.date,
      nonce,
      exp: exp.toISOString(),
    });

    return { url: `${this.webBaseUrl}/lunch/${token}` };
  }

  async verifyAndFetch(rawToken: string): Promise<VerifyResult> {
    const parsed = parseToken(rawToken);
    if (parsed === null) return { status: 'invalid' };

    const hmacKey = await this.lunchLinkRepo.findHmacKey(parsed.date);
    if (hmacKey === null) return { status: 'invalid' };

    if (!verifyHmac(parsed.encodedPayload, parsed.signature, hmacKey)) {
      return { status: 'invalid' };
    }

    const session = await this.lunchLinkRepo.findSession(parsed.child_id, parsed.date);
    if (session === null) return { status: 'invalid' };
    if (session.suppressed_at !== null && session.suppressed_at !== undefined) {
      return { status: 'invalid' };
    }

    const childInfo = await this.lunchLinkRepo.findChildPublic(parsed.child_id);
    if (childInfo === null) return { status: 'invalid' };

    const noteRow = await this.heartNoteRepo.findForDelivery(
      childInfo.household_id,
      parsed.child_id,
      parsed.date,
    );
    const heartNote =
      noteRow !== null && noteRow.content.trim().length > 0
        ? { body: noteRow.content, authorDisplayName: 'Parent' }
        : null;

    const isExpired = Date.now() >= new Date(parsed.exp).getTime();

    if (!isExpired) {
      await this.lunchLinkRepo.recordFirstOpen(parsed.child_id, parsed.date);
      return {
        status: 'valid',
        householdId: childInfo.household_id,
        childId: parsed.child_id,
        payload: {
          childName: childInfo.name,
          date: parsed.date,
          heartNote,
          bag: { ...STUB_BAG },
          expired: false,
          // Slice 4-S4: surface any prior rating so the child sees their
          // saved choice on reload (FeedbackBlock renders locked state).
          rating: session.rating ?? null,
        },
      };
    }

    await this.lunchLinkRepo.incrementReopenedCount(parsed.child_id, parsed.date);
    return {
      status: 'expired',
      householdId: childInfo.household_id,
      childId: parsed.child_id,
      expiredPayload: {
        expired: true,
        last_state_snapshot: {
          heartNote,
          rating: session.rating ?? null,
          bag: { ...STUB_BAG },
        },
      },
    };
  }

  // Slice 4-S4: child-facing rating submission. Mirrors the verifyAndFetch
  // failure-mode contract — every failure resolves to status:'invalid' so the
  // caller returns 404 regardless of WHY (oracle prevention).
  async rate(
    rawToken: string,
    rating: 'loved' | 'ok' | 'not-really',
  ): Promise<
    | { status: 'ok'; householdId: string; childId: string; date: string }
    | { status: 'invalid' }
  > {
    const parsed = parseToken(rawToken);
    if (parsed === null) return { status: 'invalid' };

    const hmacKey = await this.lunchLinkRepo.findHmacKey(parsed.date);
    if (hmacKey === null) return { status: 'invalid' };

    if (!verifyHmac(parsed.encodedPayload, parsed.signature, hmacKey)) {
      return { status: 'invalid' };
    }

    // Reject ratings after expiry — the link window has closed (8pm boundary
    // is the DB-stored exp set at generate time; no drift between GET and POST).
    if (Date.now() >= new Date(parsed.exp).getTime()) {
      return { status: 'invalid' };
    }

    const session = await this.lunchLinkRepo.findSession(parsed.child_id, parsed.date);
    if (session === null) return { status: 'invalid' };
    if (session.suppressed_at !== null && session.suppressed_at !== undefined) {
      return { status: 'invalid' };
    }

    const childInfo = await this.lunchLinkRepo.findChildPublic(parsed.child_id);
    if (childInfo === null) return { status: 'invalid' };

    // Overwrite semantics — child can change their mind before 8pm (AC3).
    await this.lunchLinkRepo.setRating(parsed.child_id, parsed.date, rating);

    return {
      status: 'ok',
      householdId: childInfo.household_id,
      childId: parsed.child_id,
      date: parsed.date,
    };
  }

  // Returns null when childId is not in the caller's household; the caller
  // raises 404 from that null.
  async getDevPayload(
    householdId: string,
    childId: string,
    date: string,
  ): Promise<LunchLinkDevResponse | null> {
    const childName = await this.lunchLinkRepo.findChildName(childId, householdId);
    if (childName === null) return null;

    const noteRow = await this.heartNoteRepo.findByChildAndDate(householdId, childId, date);

    return {
      childName,
      date,
      heartNote: noteRow
        ? { body: noteRow.content, authorDisplayName: 'Parent' }
        : null,
      bag: { ...STUB_BAG },
    };
  }
}
