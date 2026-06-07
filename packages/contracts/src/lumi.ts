import { z } from 'zod';
import { Turn } from './thread.js';

// LumiSurface — every screen the ambient Lumi companion can be aware of.
// 'onboarding' is included so the onboarding voice path keeps a valid surface
// after VoiceSessionCreateSchema migrates from a literal to this enum (ADR-002).
// 'brief' is the weekly-plan ready-answer surface (Story 3.8, BriefCanvas).
export const LumiSurfaceSchema = z.enum([
  'onboarding',
  'planning',
  'brief',
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
// `modality` (Story 5-S5) is optional and defaults to 'text' at the service
// layer: text turns from the LumiPanel composer omit it, voice turns from
// useLumiVoiceSession send 'voice' so the API stamps thread_turns.modality and
// persists a voice_transcripts row. No existing callers break.
export const LumiTurnRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  context_signal: LumiContextSignalSchema,
  modality: z.enum(['text', 'voice']).optional(),
});

// LumiThreadTurnsResponse — GET /v1/lumi/threads/:threadId/turns response
// (Story 12.3). The API caps each response at 20 turns ordered by server_seq;
// the schema does not enforce the cap so older deploys / fixtures may emit
// fewer or more — consumers should not rely on length === 20.
export const LumiThreadTurnsResponseSchema = z.object({
  thread_id: z.string().uuid(),
  turns: z.array(Turn),
});

// LumiTurnResponse — POST /v1/lumi/turns response (Story 12-S8). The API
// persists the user turn and the Lumi reply, then returns both plus the
// resolved (possibly lazy-created) thread_id so the client can append without
// a full re-hydration and pin threadIds[surface] for subsequent panel opens.
export const LumiTurnResponseSchema = z.object({
  thread_id: z.string().uuid(),
  user_turn: Turn,
  lumi_turn: Turn,
});

// VoiceTalkSessionCreate — POST /v1/lumi/voice/sessions body (Story 12.5).
// A talk session is a short-lived ElevenLabs token pair, distinct from the
// long-lived HiveKitchen user session. Surface is derived from
// context_signal.surface — no separate top-level routing key (resolves the
// drift hole flagged in 12.1 code review, Decision 1).
export const VoiceTalkSessionCreateSchema = z.object({
  context_signal: LumiContextSignalSchema,
});

// Story 5-S5b — ambient Lumi voice runs over HiveKitchen's OWN WebSocket
// (GET /v1/lumi/voice/ws), not a browser-direct ElevenLabs socket. The talk
// session is bound by id; the browser opens the HK WS with its JWT + this id,
// and the server owns STT (Scribe REST) + TTS. No ElevenLabs token crosses the
// wire any more — the old { stt_token, tts_token, voice_id } shape is gone.
export const VoiceTalkSessionResponseSchema = z.object({
  talk_session_id: z.string().uuid(),
});

// Story 5-S5b — client → server text frames on GET /v1/lumi/voice/ws. The
// browser sends `context` once on open (so the server can drive the LumiAgent
// turn with the same LumiContextSignal the text path uses), then streams WAV
// utterances as binary frames. `ping` mirrors the onboarding WS keepalive.
export const LumiVoiceClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('context'), context_signal: LumiContextSignalSchema }).strict(),
  z.object({ type: z.literal('ping') }).strict(),
]);

// NudgeTrigger — the event class that produced a proactive Lumi nudge (Story
// 12-S11). Carried on the lumi-nudge job data and stamped (DB-only) on the
// resulting thread_turns row. plan_completed is the only trigger wired at MVP;
// the remaining three are reserved for post-S12 hooks (meal rating, allergen
// flag, evening check-in).
export const NudgeTriggerSchema = z.enum([
  'plan_completed',
  'meal_rating_received',
  'allergen_flagged',
  'evening_checkin_completed',
]);

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
export type LumiTurnResponse = z.infer<typeof LumiTurnResponseSchema>;
export type VoiceTalkSessionCreate = z.infer<typeof VoiceTalkSessionCreateSchema>;
export type VoiceTalkSessionResponse = z.infer<typeof VoiceTalkSessionResponseSchema>;
export type LumiVoiceClientMessage = z.infer<typeof LumiVoiceClientMessageSchema>;
export type LumiNudgeEvent = z.infer<typeof LumiNudgeEventSchema>;
export type NudgeTrigger = z.infer<typeof NudgeTriggerSchema>;
