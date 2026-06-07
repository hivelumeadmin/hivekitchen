import { Buffer } from 'node:buffer';
import type { JWT } from '@fastify/jwt';
import { LinkExpiredError, UnauthorizedError } from '../../common/errors.js';
import type { InviteRepository, InviteRole } from './invite.repository.js';
import type { UserRepository, UserProfileRow } from '../users/user.repository.js';

const INVITE_TTL_SECONDS = 14 * 24 * 60 * 60; // 1209600 = 14d

export interface InviteClaims {
  household_id: string;
  role: InviteRole;
  invite_id: string;
  jti: string;
  exp: number;
}

export interface CreateInviteInput {
  household_id: string;
  role: InviteRole;
  invited_by_user_id: string;
  invited_email: string | null;
}

export interface CreateInviteResult {
  invite_url: string;
  invite_id: string;
}

export interface RedeemInviteResult {
  role: InviteRole;
  scope_target: string;
  household_id: string;
  invite_id: string;
}

export interface AcceptInviteResult {
  updatedUser: UserProfileRow;
  redeemResult: RedeemInviteResult;
}

export class InviteService {
  constructor(
    private readonly repository: InviteRepository,
    private readonly jwt: JWT,
    // Slice 5-S2 — optional so existing redeem-only callers/tests that construct
    // InviteService(repository, jwt) keep working; acceptInvite requires it.
    private readonly userRepository: UserRepository | null = null,
    private readonly log: { warn: (data: object, msg: string) => void } | null = null,
  ) {}

  async createInvite(input: CreateInviteInput): Promise<CreateInviteResult> {
    const expiresAt = new Date(Date.now() + INVITE_TTL_SECONDS * 1000);
    const row = await this.repository.insertInvite({
      household_id: input.household_id,
      role: input.role,
      invited_by_user_id: input.invited_by_user_id,
      invited_email: input.invited_email,
      expires_at: expiresAt,
    });

    const rawJwt = this.jwt.sign(
      {
        household_id: row.household_id,
        role: row.role,
        invite_id: row.id,
        jti: row.id,
      },
      { expiresIn: '14d' },
    );
    const encoded = Buffer.from(rawJwt, 'utf8').toString('base64url');
    return { invite_url: `/invite/${encoded}`, invite_id: row.id };
  }

  async redeemInvite(token: string): Promise<RedeemInviteResult> {
    const rawJwt = decodeBase64UrlToString(token);
    if (rawJwt === null) throw new UnauthorizedError('Invalid invite token');

    let claims: InviteClaims;
    try {
      claims = this.jwt.verify<InviteClaims>(rawJwt);
    } catch (err) {
      if (isJwtExpiredError(err)) throw new LinkExpiredError('Invite link expired');
      throw new UnauthorizedError('Invalid invite token');
    }
    if (typeof claims.jti !== 'string') throw new UnauthorizedError('Invalid invite token');

    const row = await this.repository.findInviteById(claims.jti);
    if (!row || row.redeemed_at !== null || row.revoked_at !== null) {
      throw new LinkExpiredError('Invite link expired or already used');
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new LinkExpiredError('Invite link expired');
    }

    await this.repository.markRedeemed(row.id);

    return {
      role: row.role,
      // Slice 4-S13 — grandparents land on their composer, not caregiver settings.
      scope_target:
        row.role === 'guest_author' ? '/guest-author/compose' : '/app/household/settings',
      household_id: row.household_id,
      invite_id: row.id,
    };
  }

  // Slice 5-S2 — authenticated redemption. Reuses redeemInvite() for token
  // validation + the race-safe mark-redeemed, then links the authenticated
  // invitee's account to the inviting household. redeemInvite() throws
  // LinkExpiredError (410) / UnauthorizedError (401) — let them propagate.
  async acceptInvite(token: string, requestingUserId: string): Promise<AcceptInviteResult> {
    if (this.userRepository === null) {
      throw new Error('acceptInvite requires a UserRepository');
    }
    const redeemResult = await this.redeemInvite(token);
    // P3 — only secondary_caregiver invites may be accepted via this endpoint.
    // The invite is already consumed; this prevents privilege escalation via
    // direct API calls that bypass the web client's role-based routing.
    if (redeemResult.role !== 'secondary_caregiver') {
      throw new UnauthorizedError('This invite cannot be accepted via this endpoint');
    }
    let updatedUser: UserProfileRow;
    try {
      updatedUser = await this.userRepository.setHouseholdMembership(
        requestingUserId,
        redeemResult.household_id,
        'secondary_caregiver',
      );
    } catch (err) {
      // P2 — the invite was consumed but account linkage failed. Log for ops
      // visibility; the primary parent can re-invite.
      this.log?.warn(
        { err, requestingUserId, household_id: redeemResult.household_id },
        'invite.accept: invite redeemed but setHouseholdMembership failed — user not linked',
      );
      throw err;
    }
    return { updatedUser, redeemResult };
  }
}

function decodeBase64UrlToString(token: string): string | null {
  const decoded = Buffer.from(token, 'base64url').toString('utf8');
  return decoded.length === 0 ? null : decoded;
}

function isJwtExpiredError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  // jsonwebtoken throws { name: 'TokenExpiredError' }; @fastify/jwt wraps as
  // FastifyError with code FAST_JWT_EXPIRED in newer versions. Accept either.
  return name === 'TokenExpiredError' || code === 'FAST_JWT_EXPIRED';
}
