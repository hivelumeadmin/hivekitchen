import { z } from 'zod';
import { AuthUserSchema } from './auth.js';

// ---- GET /v1/users/me + PATCH /v1/users/me response -----------------------
// Profile is a read/update surface scoped to the authenticated user. Fields
// extend AuthUserSchema (login payload) with `preferred_language` (users-table
// scalar) and `auth_providers` (derived from Supabase Auth identities).
export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().max(254),
  display_name: z.string().nullable(),
  preferred_language: z.string(),
  role: AuthUserSchema.shape.role,
  auth_providers: z.array(z.string()),
});

// ---- PATCH /v1/users/me request body --------------------------------------
// All fields optional; the service rejects an empty body with ValidationError
// so the user can update one field without sending the others.
export const UpdateProfileRequestSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(254).optional(),
  preferred_language: z.string().min(2).max(10).optional(),
});

// ---- POST /v1/auth/password-reset request body ----------------------------
// Public route — server swallows downstream errors and always returns 204 to
// prevent email enumeration. Body is parsed for shape only.
export const PasswordResetRequestSchema = z.object({
  email: z.string().email().max(254),
});
