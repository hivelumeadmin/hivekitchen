import { useCallback, useEffect, useRef, useState } from 'react';
import type { LumiContextSignal } from '@hivekitchen/types';
import {
  VoiceTalkSessionResponseSchema,
  TtsTokenResponseSchema,
  SttTokenResponseSchema,
} from '@hivekitchen/contracts';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useAuthStore } from '@/stores/auth.store.js';

export interface UseLumiVoiceSessionOptions {
  onTranscript: (text: string) => void;
  onLumiReply: (text: string) => void;
  onError: (msg: string) => void;
}

export interface UseLumiVoiceSessionReturn {
  startSession: (contextSignal: LumiContextSignal) => Promise<void>;
  endSession: () => Promise<void>;
  capReached: boolean;
}

const INACTIVITY_TIMEOUT_MS = 20_000;
const PREMIUM_FALLBACK_COPY =
  "Voice chat is part of Premium. We've got you in text — same Lumi.";
const MIC_UNAVAILABLE_COPY = 'Microphone unavailable. Check permissions and try again.';
const START_FAILED_COPY = 'Could not start voice session. Try again.';
// 5-S16 — standard-tier weekly voice cap. Must match VOICE_CAP_COPY on the API.
const VOICE_CAP_COPY = "You've used this week's voice time. Text still works.";

// Float32 PCM (VAD output) → Int16 PCM base64 (ElevenLabs Scribe WS input).
function float32ToPcm16Base64(audio: Float32Array): string {
  const pcm = new Int16Array(audio.length);
  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...(bytes.subarray(i, i + CHUNK) as unknown as number[]));
  }
  return btoa(binary);
}

// Browser sends PCM audio directly to ElevenLabs Scribe WS.
async function transcribeAudio(audio: Float32Array): Promise<string> {
  const raw = await hkFetch<unknown>('/v1/voice/stt/token', { method: 'POST' });
  const { token } = SttTokenResponseSchema.parse(raw);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=${encodeURIComponent(token)}`,
    );
    let settled = false;
    const settle = (text: string) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* noop */ }
      resolve(text);
    };

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: float32ToPcm16Base64(audio),
        commit: true,
        sample_rate: 16000,
      }));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { message_type?: string; text?: string };
        if (msg.message_type === 'committed_transcript') settle(msg.text ?? '');
      } catch { /* noop */ }
    });
    ws.addEventListener('error', () => { if (!settled) reject(new Error('STT failed')); });
    ws.addEventListener('close', () => { if (!settled) settle(''); });
  });
}

// Browser fetches TTS audio directly from ElevenLabs TTS WS.
async function fetchTtsChunks(text: string): Promise<Uint8Array[]> {
  const raw = await hkFetch<unknown>('/v1/voice/tts/token', { method: 'POST' });
  const { token, voice_id, model_id } = TtsTokenResponseSchema.parse(raw);

  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const ws = new WebSocket(
      `wss://api.elevenlabs.io/v1/text-to-speech/${voice_id}/stream-input` +
        `?single_use_token=${token}&model_id=${model_id}&output_format=mp3_44100_128`,
    );

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        text: ' ',
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
        generation_config: { chunk_length_schedule: [50] },
      }));
      ws.send(JSON.stringify({ text }));
      ws.send(JSON.stringify({ text: '' }));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { audio?: string; isFinal?: boolean };
        if (msg.audio) {
          chunks.push(Uint8Array.from(atob(msg.audio), (c) => c.charCodeAt(0)));
        }
        if (msg.isFinal) {
          try { ws.close(); } catch { /* noop */ }
          resolve(chunks);
        }
      } catch { /* noop */ }
    });
    ws.addEventListener('error', () => reject(new Error('TTS failed')));
    ws.addEventListener('close', () => resolve(chunks));
  });
}

export function useLumiVoiceSession({
  onTranscript,
  onLumiReply,
  onError,
}: UseLumiVoiceSessionOptions): UseLumiVoiceSessionReturn {
  const playingAudioRef = useRef<HTMLAudioElement | null>(null);
  const playingAudioUrlRef = useRef<string | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextSignalRef = useRef<LumiContextSignal | null>(null);
  const processingRef = useRef(false);

  const [capReached, setCapReached] = useState(false);

  const startingRef = useRef(false);
  const endingRef = useRef(false);

  const onTranscriptRef = useRef(onTranscript);
  const onLumiReplyRef = useRef(onLumiReply);
  const onErrorRef = useRef(onError);
  onTranscriptRef.current = onTranscript;
  onLumiReplyRef.current = onLumiReply;
  onErrorRef.current = onError;

  const endSessionRef = useRef<(errorMsg?: string) => Promise<void>>(async () => {});

  // ── Inactivity timer ──────────────────────────────────────────────────────

  function resetInactivityTimer() {
    if (inactivityTimerRef.current !== null) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      void endSessionRef.current();
    }, INACTIVITY_TIMEOUT_MS);
  }

  // ── TTS playback ──────────────────────────────────────────────────────────

  function playAudioChunks(chunks: Uint8Array[]) {
    if (chunks.length === 0) return;
    if (playingAudioRef.current !== null) {
      try { playingAudioRef.current.pause(); } catch { /* noop */ }
      playingAudioRef.current = null;
    }
    const blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    playingAudioRef.current = audio;
    playingAudioUrlRef.current = objectUrl;
    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(objectUrl);
      playingAudioUrlRef.current = null;
      playingAudioRef.current = null;
    });
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(objectUrl);
      playingAudioUrlRef.current = null;
      playingAudioRef.current = null;
    });
    void audio.play().catch(() => {
      URL.revokeObjectURL(objectUrl);
      playingAudioUrlRef.current = null;
      playingAudioRef.current = null;
    });
    // Keep session alive while Lumi is speaking.
    resetInactivityTimer();
  }

  // ── VAD ───────────────────────────────────────────────────────────────────
  // Loaded lazily via dynamic import on first startSession() call so the
  // onnxruntime-web WASM is never fetched until voice is actually used.

  type VadHandle = { start: () => void; pause: () => void; destroy?: () => void };
  const vadRef = useRef<VadHandle | null>(null);

  function buildOnSpeechEnd() {
    return (audio: Float32Array) => {
      if (processingRef.current) return;
      processingRef.current = true;
      resetInactivityTimer();

      void (async () => {
        try {
          let transcript: string;
          try {
            transcript = await transcribeAudio(audio);
          } catch {
            useLumiStore.setState({ voiceError: 'Could not hear that — try again' });
            return;
          }

          if (transcript.trim().length === 0) return;

          useLumiStore.setState({ voiceError: null });
          resetInactivityTimer();
          onTranscriptRef.current(transcript);

          const contextSignal = contextSignalRef.current;
          if (!contextSignal) return;

          useLumiStore.getState().setLumiThinking(true);

          let lumiReply: string;
          try {
            const result = await hkFetch<{
              thread_id: string;
              user_turn: unknown;
              lumi_turn: { body: { type: string; content: string } };
            }>('/v1/lumi/turns', {
              method: 'POST',
              body: { message: transcript, context_signal: contextSignal, modality: 'voice' },
            });
            lumiReply =
              result.lumi_turn.body.type === 'message' ? result.lumi_turn.body.content : '';
          } catch {
            useLumiStore.getState().setLumiThinking(false);
            useLumiStore.setState({ voiceError: "I'm having a little trouble — could you say that again?" });
            return;
          }

          useLumiStore.getState().setLumiThinking(false);
          onLumiReplyRef.current(lumiReply);

          if (lumiReply.trim().length === 0) return;

          // Slice 5-S13 — caption-only mode skips TTS entirely.
          if (useLumiStore.getState().captionOnlyMode) return;

          let chunks: Uint8Array[] = [];
          try {
            chunks = await fetchTtsChunks(lumiReply);
          } catch {
            useLumiStore.setState({ voiceError: 'Voice unavailable — please read the response instead' });
          }
          if (chunks.length > 0) playAudioChunks(chunks);
        } finally {
          processingRef.current = false;
        }
      })();
    };
  }

  // ── endSession ────────────────────────────────────────────────────────────

  const endSession = useCallback(async (errorMsg?: string) => {
    if (endingRef.current) return;
    endingRef.current = true;
    try {
      if (inactivityTimerRef.current !== null) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }

      try { vadRef.current?.pause(); } catch { /* noop */ }

      if (playingAudioRef.current !== null) {
        try { playingAudioRef.current.pause(); } catch { /* noop */ }
        playingAudioRef.current = null;
        if (playingAudioUrlRef.current !== null) {
          URL.revokeObjectURL(playingAudioUrlRef.current);
          playingAudioUrlRef.current = null;
        }
      }
      contextSignalRef.current = null;

      const talkSessionId = useLumiStore.getState().talkSessionId;
      if (talkSessionId !== null) {
        try {
          await hkFetch<unknown>(`/v1/lumi/voice/sessions/${talkSessionId}`, { method: 'DELETE' });
        } catch { /* best-effort */ }
      }

      useLumiStore.getState().endTalkSession();
      if (errorMsg) onErrorRef.current(errorMsg);
    } finally {
      endingRef.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  endSessionRef.current = endSession;

  useEffect(() => {
    return () => {
      if (useLumiStore.getState().talkSessionId !== null) {
        void endSessionRef.current();
      }
      try { vadRef.current?.destroy?.(); } catch { /* noop */ }
    };
  }, []);

  // ── startSession ──────────────────────────────────────────────────────────

  const startSession = useCallback(async (contextSignal: LumiContextSignal) => {
    if (startingRef.current) return;
    const curStatus = useLumiStore.getState().voiceStatus;
    if (curStatus === 'connecting' || curStatus === 'active') return;
    startingRef.current = true;
    setCapReached(false);

    if (inactivityTimerRef.current !== null) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    contextSignalRef.current = contextSignal;

    // Verify auth before any API calls.
    if (useAuthStore.getState().accessToken === null) {
      onErrorRef.current(START_FAILED_COPY);
      startingRef.current = false;
      return;
    }

    try {
      let raw: unknown;
      try {
        raw = await hkFetch<unknown>('/v1/lumi/voice/sessions', {
          method: 'POST',
          body: { context_signal: contextSignal },
        });
      } catch (err) {
        if (err instanceof HkApiError && err.status === 403) {
          onErrorRef.current(PREMIUM_FALLBACK_COPY);
          return;
        }
        if (err instanceof HkApiError && err.status === 429) {
          setCapReached(true);
          onErrorRef.current(VOICE_CAP_COPY);
          return;
        }
        onErrorRef.current(START_FAILED_COPY);
        return;
      }

      const data = VoiceTalkSessionResponseSchema.parse(raw);
      useLumiStore.getState().setTalkSession(data.talk_session_id);
      // Open the sheet in voice mode. If already summoned (e.g. user opened it
      // while the connect was in flight), update panelMode only — avoids clearing
      // pendingNudge or re-triggering Dialog mount machinery.
      if (useLumiStore.getState().presenceState === 'summoned') {
        useLumiStore.setState({ panelMode: 'voice' });
      } else {
        useLumiStore.getState().summon('voice');
      }
      useLumiStore.getState().setVoiceStatus('active');

      try {
        if (vadRef.current === null) {
          const { MicVAD } = await import('@ricky0123/vad-web');
          vadRef.current = await MicVAD.new({
            startOnLoad: false,
            onSpeechEnd: buildOnSpeechEnd(),
            positiveSpeechThreshold: 0.8,
            negativeSpeechThreshold: 0.3,
            minSpeechMs: 250,
          });
        }
        vadRef.current!.start();
      } catch {
        void endSessionRef.current(MIC_UNAVAILABLE_COPY);
        return;
      }
      resetInactivityTimer();
    } finally {
      startingRef.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { startSession, endSession, capReached };
}
