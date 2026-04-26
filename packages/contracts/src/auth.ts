import { z } from 'zod';

// ---- POST /v1/auth/login ---------------------------------------------------
export const LoginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(128),
});

// ---- POST /v1/auth/callback -----------------------------------------------
export const OAuthProviderSchema = z.enum(['google', 'apple']); // @unused-by-design — consumed by OAuthCallbackRequestSchema; standalone type used by Story 2.2 audit metadata

export const OAuthCallbackRequestSchema = z.object({
  provider: OAuthProviderSchema,
  code: z.string().min(1).max(2048),
});

// ---- Common login response (both /login and /callback) --------------------
export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().max(254),
  display_name: z.string().nullable(),
  current_household_id: z.string().uuid().nullable(),
  role: z.enum(['primary_parent', 'secondary_caregiver', 'guest_author', 'ops']),
});

export const LoginResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  user: AuthUserSchema,
  is_first_login: z.boolean(),
});

// POST /v1/auth/logout — empty 204 response, no schema needed.

// ---- POST /v1/auth/refresh ------------------------------------------------
export const RefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

// ---- POST /v1/households/:id/invites --------------------------------------
// Story 2.3 scopes invite issuance to `secondary_caregiver`. `guest_author` invites
// are added by Story 8.7 (gift / guest-author flow).
export const CreateInviteRequestSchema = z.object({
  role: z.literal('secondary_caregiver'),
  email: z.string().email().max(254).optional(),
});

export const CreateInviteResponseSchema = z.object({
  invite_url: z.string().min(1),
});

// ---- POST /v1/auth/invites/redeem -----------------------------------------
// Public route (under /v1/auth/ prefix). `token` is the base64url-encoded JWT
// from the invite URL path segment.
export const RedeemInviteRequestSchema = z.object({
  token: z.string().min(1),
});

export const RedeemInviteResponseSchema = z.object({
  role: AuthUserSchema.shape.role,
  scope_target: z.string().min(1),
  household_id: z.string().uuid(),
});
