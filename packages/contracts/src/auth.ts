import { z } from 'zod';

// ---- POST /v1/auth/login ---------------------------------------------------
export const LoginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(128),
});

// ---- POST /v1/auth/callback -----------------------------------------------
export const OAuthProviderSchema = z.enum(['google', 'apple']);

export const OAuthCallbackRequestSchema = z.object({
  provider: OAuthProviderSchema,
  code: z.string().min(1).max(2048),
});

// ---- Common login response (both /login and /callback) --------------------
export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().nullable(),
  current_household_id: z.string().uuid().nullable(),
  role: z.enum(['primary_parent', 'secondary_caregiver', 'guest_author', 'ops']),
});

export const LoginResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().positive(),
  user: AuthUserSchema,
  is_first_login: z.boolean(),
});

// POST /v1/auth/logout — empty 204 response, no schema needed.
