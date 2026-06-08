import { useCallback, useEffect, useRef } from 'react';
import { useMicVAD } from '@ricky0123/vad-react';
import type { LumiContextSignal } from '@hivekitchen/types';
import {
  VoiceTalkSessionResponseSchema,
  WsServerMessageSchema,
  type WsServerMessage,
} from '@hivekitchen/contracts';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { encodeWav } from '@/lib/encodeWav.js';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useAuthStore } from '@/stores/auth.store.js';

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

const WS_BASE_URL = import.meta.env.VITE_API_WS_URL;

const INACTIVITY_TIMEOUT_MS = 20_000;
const PREMIUM_FALLBACK_COPY =
  "Voice chat is part of Premium. We've got you in text — same Lumi.";
const CONNECTION_LOST_COPY = 'Voice connection lost. Try again.';
const MIC_UNAVAILABLE_COPY = 'Microphone unavailable. Check permissions and try again.';
const START_FAILED_COPY = 'Could not start voice session. Try again.';

// ── Hook ───────────────────────────────────────────────────────────────────
// Story 5-S5b — ambient Lumi voice runs over HiveKitchen's OWN WebSocket
// (GET /v1/lumi/voice/ws), mirroring the onboarding voice path (2.6b). The
// browser does client-side VAD, ships each complete utterance as a WAV binary
// frame, and the server transcribes (Scribe), runs the LumiAgent turn, and
// streams the TTS reply back as MP3 chunks. There is NO ElevenLabs Conversational
// AI agent and no browser-direct ElevenLabs socket anywhere in this path.

export function useLumiVoiceSession({
  onTranscript,
  onLumiReply,
  onError,
}: UseLumiVoiceSessionOptions): UseLumiVoiceSessionReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const audioBufferRef = useRef<{ seq: number; chunks: Uint8Array[] } | null>(null);
  const playingAudioRef = useRef<HTMLAudioElement | null>(null);
  const playingAudioUrlRef = useRef<string | null>(null);
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

  // ── Inactivity timer ──────────────────────────────────────────────────────

  function resetInactivityTimer() {
    if (inactivityTimerRef.current !== null) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      void endSessionRef.current();
    }, INACTIVITY_TIMEOUT_MS);
  }

  // ── TTS playback (mirrors onboarding useVoiceSession — MP3 Blob via Audio) ──

  function playBufferedAudio() {
    const buf = audioBufferRef.current;
    audioBufferRef.current = null;
    if (!buf || buf.chunks.length === 0) return;
    if (playingAudioRef.current !== null) {
      try { playingAudioRef.current.pause(); } catch { /* noop */ }
      playingAudioRef.current = null;
    }
    const blob = new Blob(buf.chunks as BlobPart[], { type: 'audio/mpeg' });
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
    // Keep the session alive while Lumi is speaking — a long reply must not
    // trip the inactivity timer mid-playback.
    resetInactivityTimer();
  }

  // ── Server frame handling ─────────────────────────────────────────────────

  function handleServerMessage(msg: WsServerMessage) {
    switch (msg.type) {
      case 'session.ready':
        return;
      case 'transcript':
        // STT succeeded — clear any prior transient notice and reset inactivity
        // even before the reply lands, so a long turn doesn't auto-end.
        if (useLumiStore.getState().voiceError !== null) {
          useLumiStore.setState({ voiceError: null });
        }
        resetInactivityTimer();
        onTranscriptRef.current(msg.text);
        return;
      case 'lumi.thinking':
        // Slice 5-S6 — non-verbal "thinking" signal for the STT→reply gap.
        useLumiStore.getState().setLumiThinking(true);
        return;
      case 'response.start':
        // Reply is arriving — the gap is over, clear the thinking pulse.
        useLumiStore.getState().setLumiThinking(false);
        audioBufferRef.current = { seq: msg.seq, chunks: [] };
        return;
      case 'response.end':
        useLumiStore.getState().setLumiThinking(false);
        onLumiReplyRef.current(msg.text);                  // captions ALWAYS fire
        // Slice 5-S13 — caption-only mode discards the accumulated MP3 buffer
        // instead of playing it. Reading the flag via getState() is correct here:
        // this runs inside the WS message handler closure, not a React render.
        if (useLumiStore.getState().captionOnlyMode) {
          audioBufferRef.current = null;
        } else {
          playBufferedAudio();
        }
        return;
      case 'session.summary':
        // Ambient Lumi never emits an onboarding summary — ignore defensively.
        return;
      case 'error':
        // Non-fatal: surface a transient notice but keep the session live so the
        // user can simply speak again (12-S10 behaviour). Direct setState keeps
        // voiceStatus at 'active' — do NOT route through setVoiceError/endSession.
        // Also clear the thinking pulse so a failed turn never leaves it hanging.
        useLumiStore.getState().setLumiThinking(false);
        useLumiStore.setState({ voiceError: msg.message });
        return;
    }
  }

  // ── VAD — client-side speech detection → WAV over the HK WS ────────────────

  const vad = useMicVAD({
    startOnLoad: false,
    onSpeechEnd: (audio: Float32Array) => {
      const ws = wsRef.current;
      if (ws === null || ws.readyState !== WebSocket.OPEN) return;
      // The user spoke — reset inactivity even before the transcript returns,
      // so STT latency on a long utterance doesn't auto-end the session.
      resetInactivityTimer();
      const wav = encodeWav(audio, 16000);
      // Copy into a fresh ArrayBuffer so WS.send receives a plain ArrayBuffer
      // (Uint8Array.buffer can be a SharedArrayBuffer in some runtimes).
      const ab = new ArrayBuffer(wav.byteLength);
      new Uint8Array(ab).set(wav);
      ws.send(ab);
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
  // the error path when a session is live.
  useEffect(() => {
    if (!vad.errored) return;
    const status = useLumiStore.getState().voiceStatus;
    if (status === 'connecting' || status === 'active') {
      void endSessionRef.current(MIC_UNAVAILABLE_COPY);
    }
  }, [vad.errored]);

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

      // Null the ref BEFORE closing to guard against close-event → endSession re-entry
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws !== null) {
        try { ws.close(1000, 'session ended'); } catch { /* noop */ }
      }

      if (playingAudioRef.current !== null) {
        try { playingAudioRef.current.pause(); } catch { /* noop */ }
        playingAudioRef.current = null;
        if (playingAudioUrlRef.current !== null) {
          URL.revokeObjectURL(playingAudioUrlRef.current);
          playingAudioUrlRef.current = null;
        }
      }
      audioBufferRef.current = null;
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
      // 'text' (the text fallback). When ending due to an error, re-set the
      // error AFTER the reset so voiceStatus:'error' + the role="alert" message
      // survive (otherwise the cleanup clobbers them).
      useLumiStore.getState().endTalkSession();
      if (errorMsg) onErrorRef.current(errorMsg);
    } finally {
      endingRef.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  endSessionRef.current = endSession;

  // End any live session if the layout unmounts (logout / navigation away):
  // otherwise the mic stream stays hot, the WS + Audio leak, the timer keeps
  // firing, and the server talk-session row is never DELETEd. Guarded on an
  // existing session so idle unmounts stay quiet.
  useEffect(() => {
    return () => {
      if (useLumiStore.getState().talkSessionId !== null) {
        void endSessionRef.current();
      }
    };
  }, []);

  // ── HiveKitchen voice WebSocket ───────────────────────────────────────────

  function openWs(sessionId: string, accessToken: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `${WS_BASE_URL}/v1/lumi/voice/ws?session_id=${encodeURIComponent(sessionId)}` +
          `&token=${encodeURIComponent(accessToken)}`,
      );
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        // Identity guard: if teardown already swapped/nulled the ref (session
        // ended mid-connect), this late open must not resurrect a live socket.
        if (wsRef.current !== ws) {
          try { ws.close(); } catch { /* noop */ }
          return;
        }
        // Send the context frame first so the server can drive the LumiAgent
        // turn with the same LumiContextSignal the text path uses. It travels
        // ahead of any audio on this ordered socket (VAD starts after this).
        const ctx = contextSignalRef.current;
        if (ctx !== null) {
          try { ws.send(JSON.stringify({ type: 'context', context_signal: ctx })); } catch { /* noop */ }
        }
        resolve();
      });

      ws.addEventListener('message', (event) => {
        if (wsRef.current !== ws) return;
        if (typeof event.data === 'string') {
          let parsed: unknown;
          try { parsed = JSON.parse(event.data); } catch { return; }
          const result = WsServerMessageSchema.safeParse(parsed);
          if (!result.success) return;
          handleServerMessage(result.data);
          return;
        }
        // Binary — MP3 chunk for the in-flight Lumi response.
        const buf = audioBufferRef.current;
        if (!buf) return;
        if (event.data instanceof ArrayBuffer) {
          if (audioBufferRef.current?.seq === buf.seq) {
            buf.chunks.push(new Uint8Array(event.data));
          }
        } else if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then((ab) => {
            const b = audioBufferRef.current;
            if (b && b.seq === buf.seq) b.chunks.push(new Uint8Array(ab));
          });
        }
      });

      ws.addEventListener('error', () => {
        // Compare identity, not nullness: a stale socket's late error must not
        // tear down a freshly-started session.
        if (wsRef.current === ws) void endSessionRef.current(CONNECTION_LOST_COPY);
        reject(new Error('voice WS error'));
      });

      ws.addEventListener('close', (e) => {
        if (e.code !== 1000 && wsRef.current === ws) {
          void endSessionRef.current(CONNECTION_LOST_COPY);
        }
      });
    });
  }

  // ── startSession ──────────────────────────────────────────────────────────

  const startSession = useCallback(async (contextSignal: LumiContextSignal) => {
    // Guard double-start: voiceStatus stays 'idle' until the POST resolves, so
    // a second click before then would otherwise spawn a 2nd session + WS and
    // orphan the first (leaked socket, undeleted server row).
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

    const accessToken = useAuthStore.getState().accessToken;
    if (accessToken === null || !WS_BASE_URL) {
      onErrorRef.current(START_FAILED_COPY);
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
          // Standard-tier or non-primary-parent: graceful fallback, no WS, no
          // mode switch — panel stays in text mode.
          onErrorRef.current(PREMIUM_FALLBACK_COPY);
          return;
        }
        onErrorRef.current(START_FAILED_COPY);
        return;
      }

      const data = VoiceTalkSessionResponseSchema.parse(raw);

      useLumiStore.getState().setTalkSession(data.talk_session_id); // → voiceStatus: 'connecting'
      // Surface voice mode so the Voice tab reads active and the "tap the orb
      // to end" hint renders (isVoiceMode = panelMode === 'voice').
      useLumiStore.getState().openPanel('voice');

      try {
        await openWs(data.talk_session_id, accessToken);
      } catch {
        // The WS error/close handler triggers endSession cleanup.
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
