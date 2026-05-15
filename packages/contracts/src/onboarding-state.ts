import { z } from 'zod';

// 2-S26 — GET /v1/onboarding/state response. Three-state machine that drives
// the /onboarding entry surface:
//   - not_started: no active onboarding thread for the household. The mode
//     picker renders (the normal first-time path).
//   - in_progress: an active onboarding thread exists with at least one user
//     turn. The Resume surface renders with prior turns + Continue/Start over.
//   - completed: the household has a closed onboarding thread with a summary
//     event, OR the 2-S19 derivation (parental notice ack + child) is true.
//     Defensive: the /onboarding page shouldn't usually see this — auth
//     callbacks route completed users to /app — but if hit manually, the
//     page can redirect without blowing up.
export const OnboardingStateStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'completed',
]);

// One turn in the resumable transcript. The synthetic OPENING_GREETING is
// excluded from the returned array (it's a client-render constant — see
// onboarding.ts). Only real user/lumi turns flow through here.
export const OnboardingTurnSnapshotSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'lumi']),
  content: z.string(),
  created_at: z.string().datetime(),
});

export const OnboardingStateResponseSchema = z.object({
  status: OnboardingStateStatusSchema,
  // Populated when status='in_progress'. Optional fields are left undefined
  // for the other states rather than forcing the client to discriminate.
  thread_id: z.string().uuid().optional(),
  modality: z.enum(['text', 'voice']).optional(),
  started_at: z.string().datetime().optional(),
  last_activity_at: z.string().datetime().optional(),
  turns: z.array(OnboardingTurnSnapshotSchema).optional(),
});

// POST /v1/onboarding/state/reset has no body and no response body (204).
// Idempotent: closes the active thread (if any) and writes a reset audit
// breadcrumb so the prior thread is discoverable in audit trail.

export type OnboardingStateStatus = z.infer<typeof OnboardingStateStatusSchema>;
export type OnboardingTurnSnapshot = z.infer<typeof OnboardingTurnSnapshotSchema>;
export type OnboardingStateResponse = z.infer<typeof OnboardingStateResponseSchema>;
