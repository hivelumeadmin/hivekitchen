import { z } from 'zod';
import { AuthUserSchema } from './auth.js';

// ---- Notification preferences (Story 2.5) ---------------------------------
// Heart Note anti-pattern (Story 4.13): NO heart_note_* field of any kind.
// `notification_prefs` JSONB on users is constrained to these two booleans only.
export const NotificationPrefsSchema = z.object({
  weekly_plan_ready: z.boolean(),
  grocery_list_ready: z.boolean(),
});

// PATCH /v1/users/me/notifications request — at least one field required.
// Server merges into existing prefs (does not replace); fields omitted retain prior value.
export const UpdateNotificationPrefsRequestSchema = z
  .object({
    weekly_plan_ready: z.boolean().optional(),
    grocery_list_ready: z.boolean().optional(),
  })
  .refine(
    (d) => d.weekly_plan_ready !== undefined || d.grocery_list_ready !== undefined,
    { message: 'At least one field required' },
  );

// ---- Cultural language preference (Story 2.5, FR105/FR106) ----------------
// Aligned with FR6 cultural-template families. Mirrors the
// `cultural_language_preference` Postgres enum.
export const CULTURAL_LANGUAGE_VALUES = [
  'default',
  'south_asian',
  'hispanic',
  'east_african',
  'middle_eastern',
  'east_asian',
  'caribbean',
] as const;
export const CulturalLanguageSchema = z.enum(CULTURAL_LANGUAGE_VALUES);

// PATCH /v1/users/me/preferences request body.
// UX-DR47 ratchet (forward-only) is enforced at the service layer, not here.
export const UpdateCulturalPreferenceRequestSchema = z.object({
  cultural_language: CulturalLanguageSchema,
});

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
  notification_prefs: NotificationPrefsSchema,
  cultural_language: CulturalLanguageSchema,
  parental_notice_acknowledged_at: z.string().datetime().nullable(),
  parental_notice_acknowledged_version: z.string().nullable(),
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

// ---- POST /v1/auth/password-reset-complete request body -------------------
// Public route. `token` is the Supabase recovery token_hash from the email
// link (`?token_hash=...&type=recovery`). Password rules mirror LoginRequest.
export const PasswordResetCompleteRequestSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12).max(128),
});
