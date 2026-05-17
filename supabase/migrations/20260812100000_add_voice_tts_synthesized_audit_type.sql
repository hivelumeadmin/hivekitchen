-- Slice 2-S20: one-shot TTS for on-page narration ("Listen to Lumi" on the
-- onboarding landing). The route at POST /v1/voice/tts writes a
-- 'voice.tts_synthesized' audit event per call; the audit_event_type enum
-- needs the value added before that write can succeed.

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'voice.tts_synthesized';
