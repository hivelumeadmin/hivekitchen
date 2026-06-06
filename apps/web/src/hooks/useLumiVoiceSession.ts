import { useCallback, useEffect, useRef } from 'react';
import { useMicVAD } from '@ricky0123/vad-react';
import type { LumiContextSignal } from '@hivekitchen/types';
import { VoiceTalkSessionResponseSchema, LumiTurnResponseSchema } from '@hivekitchen/contracts';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiStore } from '@/stores/lumi.store.js';

// ── Audio helpers ──────────────────────────────────────────────────────────

function float32ToInt16(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToBase64(int16: Int16Array): string {
  // Chunked conversion: per-byte string concat over a full utterance (tens of
  // KB+) is O(n²) and janks on longer speech. fromCharCode spreads ≤ 0x8000
  // args per call (safe stack budget) and concatenates O(n).
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface UseLumiVoiceSessionOptions {
  onTranscript: (text: string) => void;
  onLumiReply: (text: string) => void;
  onError: (msg: string) => void;
}

export interface UseLumiVoiceSessionReturn {
  startSession: (contextSignal: LumiContextSignal) => Promise<void>;
  endSession: () => Promise<void>;
}

const INACTIVITY_TIMEOUT_MS = 20_000;
const PREMIUM_FALLBACK_COPY =
  "Voice chat is part of Premium. We've got you in text — same Lumi.";
const CONNECTION_LOST_COPY = 'Voice connection lost. Try again.';
const MIC_UNAVAILABLE_COPY = 'Microphone unavailable. Check permissions and try again.';
const TRANSCRIPT_FAILED_COPY = "Lumi didn't catch that. Try again.";

// ── Hook ───────────────────────────────────────────────────────────────────

export function useLumiVoiceSession({
  onTranscript,
  onLumiReply,
  onError,
}: UseLumiVoiceSessionOptions): UseLumiVoiceSessionReturn {
  const ttsWsRef = useRef<WebSocket | null>(null);
  const sttWsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextSignalRef = useRef<LumiContextSignal | null>(null);

  // Re-entrancy guards: many paths can fire start/end simultaneously
  // (double-click, WS error + orb tap, inactivity timer + unmount).
  const startingRef = useRef(false);
  const endingRef = useRef(false);

  // Callback refs so closures in WS handlers never go stale across re-renders
  const onTranscriptRef = useRef(onTranscript);
  const onLumiReplyRef = useRef(onLumiReply);
  const onErrorRef = useRef(onError);
  onTranscriptRef.current = onTranscript;
  onLumiReplyRef.current = onLumiReply;
  onErrorRef.current = onError;

  // endSessionRef lets timer/WS callbacks call endSession before it's defined
  const endSessionRef = useRef<(errorMsg?: string) => Promise<void>>(async () => {});

  // ── TTS audio playback (mirrors MediaPanels.tsx pattern) ──────────────────

  function playAudioChunk(base64: string) {
    const ctx = audioCtxRef.current;
    if (ctx === null) return;
    let binary: string;
    try { binary = atob(base64); } catch { return; }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)!;
    // Guard odd byte lengths: new Int16Array(buffer, off, len) throws on a
    // fractional length. Drop the trailing odd byte rather than throw out of
    // the WS message handler.
    const usableLen = bytes.byteLength - (bytes.byteLength % 2);
    if (usableLen === 0) return;
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, usableLen / 2);
    const float = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) float[i] = pcm[i]! / 0x8000;
    if (float.length === 0) return;
    const buffer = ctx.createBuffer(1, float.length, 16000);
    buffer.copyToChannel(float, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
    // Keep the session alive while Lumi is speaking — a long reply must not
    // trip the inactivity timer mid-playback.
    resetInactivityTimer();
  }

  function sendToTts(text: string) {
    const ws = ttsWsRef.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ text }));
    ws.send(JSON.stringify({ text: '' }));
  }

  // ── Inactivity timer ──────────────────────────────────────────────────────

  function resetInactivityTimer() {
    if (inactivityTimerRef.current !== null) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      void endSessionRef.current();
    }, INACTIVITY_TIMEOUT_MS);
  }

  // ── VAD ──────────────────────────────────────────────────────────────────
  // Option A: ElevenLabs Conversational AI WebSocket for STT.
  // stt_token from POST /v1/lumi/voice/sessions is a signed WSS URL
  // (ElevenLabs /v1/convai/conversation/get_signed_url). We send mic audio as
  // base64 PCM chunks and listen for { type: 'user_transcript' } messages.
  // USER-SIDE GATE: the ElevenLabs agent (ELEVENLABS_VOICE_ID) must be
  // configured in the ElevenLabs dashboard without a built-in LLM response so
  // that HiveKitchen's LumiAgent handles the reply.

  const vad = useMicVAD({
    startOnLoad: false,
    onSpeechEnd: (audio: Float32Array) => {
      const sttWs = sttWsRef.current;
      if (sttWs === null || sttWs.readyState !== WebSocket.OPEN) return;
      // The user spoke — reset inactivity even before the transcript returns,
      // so STT latency on a long utterance doesn't auto-end the session.
      resetInactivityTimer();
      const int16 = float32ToInt16(audio);
      const b64 = int16ToBase64(int16);
      sttWs.send(JSON.stringify({ user_audio_chunk: b64 }));
    },
    positiveSpeechThreshold: 0.8,
    negativeSpeechThreshold: 0.3,
    minSpeechMs: 250,
  });

  // vadRef keeps the latest vad instance accessible from stable callbacks
  const vadRef = useRef(vad);
  vadRef.current = vad;

  // Mic-permission denial / device failure surfaces asynchronously via
  // vad.errored (vad.start() does not synchronously throw). Observe it and run
  // the AC#8 error path when a session is live. (AC#8 + USER-SIDE GATE #1.)
  useEffect(() => {
    if (!vad.errored) return;
    const status = useLumiStore.getState().voiceStatus;
    if (status === 'connecting' || status === 'active') {
      void endSessionRef.current(MIC_UNAVAILABLE_COPY);
    }
  }, [vad.errored]);

  // ── Transcript → HK API → TTS ──────────────────────────────────────────

  async function handleTranscript(text: string) {
    // Empty transcript would POST message:'' and hit the server's min(1) 400.
    if (!text.trim()) return;
    resetInactivityTimer();
    onTranscriptRef.current(text);

    const contextSignal = contextSignalRef.current;
    if (contextSignal === null) return;

    try {
      const raw = await hkFetch<unknown>('/v1/lumi/turns', {
        method: 'POST',
        body: { message: text, context_signal: contextSignal },
      });
      const data = LumiTurnResponseSchema.parse(raw);

      // Clear any prior transient transcript-failure notice on success.
      // Direct setState (not setVoiceError) so we don't disturb voiceStatus.
      if (useLumiStore.getState().voiceError !== null) {
        useLumiStore.setState({ voiceError: null });
      }

      // Pin thread ID so subsequent panel opens pre-hydrate correctly
      const surface = contextSignal.surface;
      useLumiStore.setState((s) => ({
        threadIds: { ...s.threadIds, [surface]: data.thread_id },
      }));

      // Append real turns from API (no optimistic display needed for voice)
      useLumiStore.getState().appendTurn(data.user_turn);
      useLumiStore.getState().appendTurn(data.lumi_turn);

      const lumiText =
        data.lumi_turn.body.type === 'message' ? data.lumi_turn.body.content : '';
      if (lumiText) {
        onLumiReplyRef.current(lumiText);
        sendToTts(lumiText);
      }
    } catch {
      // Surface a transient notice but keep the session live so the user can
      // simply speak again (decision: surface + stay in session). Direct
      // setState keeps voiceStatus at 'active' — do NOT route through
      // setVoiceError/endSession, which would tear the session down.
      useLumiStore.setState({ voiceError: TRANSCRIPT_FAILED_COPY });
    }
  }

  // ── endSession ────────────────────────────────────────────────────────────

  const endSession = useCallback(async (errorMsg?: string) => {
    // Re-entrancy guard: concurrent callers (inactivity timer + orb tap, WS
    // error + manual end) must not each read talkSessionId and fire a second
    // DELETE for the same session.
    if (endingRef.current) return;
    endingRef.current = true;
    try {
      if (inactivityTimerRef.current !== null) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }

      try { vadRef.current.pause(); } catch { /* noop */ }

      // Null refs BEFORE closing to guard against close-event → endSession re-entry
      const ttsWs = ttsWsRef.current;
      ttsWsRef.current = null;
      if (ttsWs !== null) {
        try { ttsWs.close(1000, 'session ended'); } catch { /* noop */ }
      }

      const sttWs = sttWsRef.current;
      sttWsRef.current = null;
      if (sttWs !== null) {
        try { sttWs.close(1000, 'session ended'); } catch { /* noop */ }
      }

      if (audioCtxRef.current !== null) {
        try { await audioCtxRef.current.close(); } catch { /* noop */ }
        audioCtxRef.current = null;
      }
      nextPlayTimeRef.current = 0;
      contextSignalRef.current = null;

      const talkSessionId = useLumiStore.getState().talkSessionId;
      if (talkSessionId !== null) {
        try {
          await hkFetch<unknown>(`/v1/lumi/voice/sessions/${talkSessionId}`, {
            method: 'DELETE',
          });
        } catch { /* best-effort */ }
      }

      // endTalkSession resets voiceStatus→'idle', voiceError→null, panelMode→
      // 'text' (the AC#8 text fallback). When ending due to an error, re-set
      // the error AFTER the reset so voiceStatus:'error' + the role="alert"
      // message survive (otherwise the cleanup clobbers them). (AC#8.)
      useLumiStore.getState().endTalkSession();
      if (errorMsg) onErrorRef.current(errorMsg);
    } finally {
      endingRef.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  endSessionRef.current = endSession;

  // End any live session if the layout unmounts (logout / navigation away):
  // otherwise the mic stream stays hot, both WS + AudioContext leak, the timer
  // keeps firing, and the server talk-session row is never DELETEd. Guarded on
  // an existing session so idle unmounts stay quiet.
  useEffect(() => {
    return () => {
      if (useLumiStore.getState().talkSessionId !== null) {
        void endSessionRef.current();
      }
    };
  }, []);

  // ── TTS WebSocket ─────────────────────────────────────────────────────────

  function openTtsWs(ttsToken: string, voiceId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({
        single_use_token: ttsToken,
        model_id: 'eleven_multilingual_v2',
        output_format: 'pcm_16000',
      });
      const url =
        `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
        `/stream-input?${params.toString()}`;

      const ws = new WebSocket(url);
      ttsWsRef.current = ws;

      ws.addEventListener('open', () => {
        // Identity guard: if teardown already swapped/nulled the ref (peer WS
        // errored, session ended mid-connect), this late open must not
        // resurrect an AudioContext + sending socket nobody will close.
        if (ttsWsRef.current !== ws) {
          try { ws.close(); } catch { /* noop */ }
          return;
        }
        audioCtxRef.current = new AudioContext({ sampleRate: 16000 });
        void audioCtxRef.current.resume();
        nextPlayTimeRef.current = 0;

        ws.send(
          JSON.stringify({
            text: ' ',
            voice_settings: { stability: 0.5, similarity_boost: 0.8 },
            generation_config: { chunk_length_schedule: [120] },
          }),
        );
        resolve();
      });

      ws.addEventListener('message', (event) => {
        if (ttsWsRef.current !== ws) return;
        if (typeof event.data !== 'string') return;
        let msg: unknown;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (typeof msg !== 'object' || msg === null) return;
        const m = msg as { audio?: unknown };
        if (typeof m.audio === 'string' && m.audio.length > 0) {
          playAudioChunk(m.audio);
        }
      });

      ws.addEventListener('error', () => {
        // Compare identity, not nullness: a stale socket's late error must not
        // tear down a freshly-started session.
        if (ttsWsRef.current === ws) void endSessionRef.current(CONNECTION_LOST_COPY);
        reject(new Error('TTS WS error'));
      });

      ws.addEventListener('close', (e) => {
        if (e.code !== 1000 && ttsWsRef.current === ws) {
          void endSessionRef.current(CONNECTION_LOST_COPY);
        }
      });
    });
  }

  // ── STT WebSocket — Option A: ElevenLabs Conversational AI ───────────────

  function openSttWs(sttToken: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // sttToken is the full signed WSS URL from ElevenLabs get_signed_url
      const ws = new WebSocket(sttToken);
      sttWsRef.current = ws;

      ws.addEventListener('open', () => {
        if (sttWsRef.current !== ws) {
          try { ws.close(); } catch { /* noop */ }
          return;
        }
        resolve();
      });

      ws.addEventListener('message', (event) => {
        if (sttWsRef.current !== ws) return;
        if (typeof event.data !== 'string') return;
        let msg: unknown;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (typeof msg !== 'object' || msg === null) return;
        const m = msg as { type?: unknown; user_transcript?: unknown };
        if (m.type === 'user_transcript' && typeof m.user_transcript === 'string') {
          void handleTranscript(m.user_transcript);
        }
      });

      ws.addEventListener('error', () => {
        if (sttWsRef.current === ws) void endSessionRef.current(CONNECTION_LOST_COPY);
        reject(new Error('STT WS error'));
      });

      ws.addEventListener('close', (e) => {
        if (e.code !== 1000 && sttWsRef.current === ws) {
          void endSessionRef.current(CONNECTION_LOST_COPY);
        }
      });
    });
  }

  // ── startSession ──────────────────────────────────────────────────────────

  const startSession = useCallback(async (contextSignal: LumiContextSignal) => {
    // Guard double-start: voiceStatus stays 'idle' until the POST resolves, so
    // a second click before then would otherwise spawn a 2nd session + WS pair
    // and orphan the first (leaked sockets, undeleted server row).
    if (startingRef.current) return;
    const curStatus = useLumiStore.getState().voiceStatus;
    if (curStatus === 'connecting' || curStatus === 'active') return;
    startingRef.current = true;

    // Clear any stale inactivity timer left by a prior session before we begin.
    if (inactivityTimerRef.current !== null) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    contextSignalRef.current = contextSignal;

    try {
      let raw: unknown;
      try {
        raw = await hkFetch<unknown>('/v1/lumi/voice/sessions', {
          method: 'POST',
          body: { context_signal: contextSignal },
        });
      } catch (err) {
        if (err instanceof HkApiError && err.status === 403) {
          // Standard-tier or non-primary-parent: graceful fallback, no WS, no
          // mode switch — panel stays in text mode (AC#2).
          onErrorRef.current(PREMIUM_FALLBACK_COPY);
          return;
        }
        onErrorRef.current('Could not start voice session. Try again.');
        return;
      }

      const data = VoiceTalkSessionResponseSchema.parse(raw);
      useLumiStore.getState().setTalkSession(data.talk_session_id); // → voiceStatus: 'connecting'
      // Surface voice mode so the Voice tab reads active and the "tap the orb
      // to end" hint renders (isVoiceMode = panelMode === 'voice').
      useLumiStore.getState().openPanel('voice');

      try {
        // Open both connections concurrently; both must succeed before going active
        await Promise.all([
          openTtsWs(data.tts_token, data.voice_id),
          openSttWs(data.stt_token),
        ]);
      } catch {
        // Individual WS error/close handlers trigger endSession cleanup
        return;
      }

      useLumiStore.getState().setVoiceStatus('active');
      try {
        vadRef.current.start();
      } catch {
        void endSessionRef.current(MIC_UNAVAILABLE_COPY);
        return;
      }
      resetInactivityTimer();
    } finally {
      startingRef.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { startSession, endSession };
}
