import { z } from 'zod';
import { Turn } from './thread.js';

// LumiSurface — every screen the ambient Lumi companion can be aware of.
// 'onboarding' is included so the onboarding voice path keeps a valid surface
// after VoiceSessionCreateSchema migrates from a literal to this enum (ADR-002).
export const LumiSurfaceSchema = z.enum([
  'onboarding',
  'planning',
  'meal-detail',
  'child-profile',
  'grocery-list',
  'evening-check-in',
  'heart-note',
  'general',
]);

// LumiContextSignal — assembled on the frontend, carried with every Lumi turn
// (voice and text). Describes what the user is currently viewing so Lumi can
// answer in context. recent_actions is a rolling queue of the last 5 actions
// on the current surface. Per-string caps keep the payload bounded — sibling
// fields (entity_summary, message) follow the same pattern.
export const LumiContextSignalSchema = z.object({
  surface: LumiSurfaceSchema,
  entity_type: z.string().min(1).max(64).optional(),
  entity_id: z.string().uuid().optional(),
  entity_summary: z.string().max(500).optional(),
  recent_actions: z.array(z.string().min(1).max(200)).max(5).optional(),
});

// LumiTurnRequest — POST /v1/lumi/turns body (text-mode turn; Story 12.10).
// .trim() runs before .min(1) so whitespace-only messages are rejected.
export const LumiTurnRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  context_signal: LumiContextSignalSchema,
});

// LumiThreadTurnsResponse — GET /v1/lumi/threads/:threadId/turns response
// (Story 12.3). The API caps each response at 20 turns ordered by server_seq;
// the schema does not enforce the cap so older deploys / fixtures may emit
// fewer or more — consumers should not rely on length === 20.
export const LumiThreadTurnsResponseSchema = z.object({
  thread_id: z.string().uuid(),
  turns: z.array(Turn),
});

// VoiceTalkSessionCreate — POST /v1/lumi/voice/sessions body (Story 12.5).
// A talk session is a short-lived ElevenLabs token pair, distinct from the
// long-lived HiveKitchen user session. Surface is derived from
// context_signal.surface — no separate top-level routing key (resolves the
// drift hole flagged in 12.1 code review, Decision 1).
export const VoiceTalkSessionCreateSchema = z.object({
  context_signal: LumiContextSignalSchema,
});

// Tokens are passed straight to ElevenLabs — fail fast on whitespace or
// implausibly long values rather than letting ElevenLabs reject them.
const VoiceCredentialSchema = z.string().min(1).max(2048).regex(/^\S+$/);

export const VoiceTalkSessionResponseSchema = z.object({
  talk_session_id: z.string().uuid(),
  stt_token: VoiceCredentialSchema,
  tts_token: VoiceCredentialSchema,
  voice_id: VoiceCredentialSchema,
});

// LumiNudgeEvent — SSE payload for proactive Lumi nudges (Story 12.11).
export const LumiNudgeEventSchema = z.object({
  type: z.literal('lumi.nudge'),
  turn: Turn,
  surface: LumiSurfaceSchema,
});

// Inferred types
export type LumiSurface = z.infer<typeof LumiSurfaceSchema>;
export type LumiContextSignal = z.infer<typeof LumiContextSignalSchema>;
export type LumiTurnRequest = z.infer<typeof LumiTurnRequestSchema>;
export type LumiThreadTurnsResponse = z.infer<typeof LumiThreadTurnsResponseSchema>;
export type VoiceTalkSessionCreate = z.infer<typeof VoiceTalkSessionCreateSchema>;
export type VoiceTalkSessionResponse = z.infer<typeof VoiceTalkSessionResponseSchema>;
export type LumiNudgeEvent = z.infer<typeof LumiNudgeEventSchema>;
