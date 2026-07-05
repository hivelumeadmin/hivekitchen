import { useCallback, useEffect, useRef, useState } from 'react';
import { useMicVAD } from '@ricky0123/vad-react';
import {
  VoiceSessionCreateResponseSchema,
  TtsTokenResponseSchema,
  SttTokenResponseSchema,
} from '@hivekitchen/contracts';
import { hkFetch } from '@/lib/fetch.js';

type VoiceSessionStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'closing'
  | 'closed'
  | 'error';

export interface VoiceSessionCallbacks {
  onComplete: (result: { cultural_priors_detected: boolean }) => void;
  onError?: (message: string) => void;
}

export interface UseVoiceSessionResult {
  status: VoiceSessionStatus;
  transcriptLines: string[];
  lumiLines: string[];
  errorMessage: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

// Float32 PCM (VAD output) → Int16 PCM base64 (ElevenLabs Scribe WS input).
// Chunk-based encoding avoids stack overflow on large audio arrays.
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

// Browser sends PCM audio directly to ElevenLabs Scribe WS; audio never
// transits the HK API. Returns the committed transcript text.
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
    // Server closes after delivering the transcript; resolve with whatever we got.
    ws.addEventListener('close', () => { if (!settled) settle(''); });
  });
}

// Browser requests TTS audio directly from ElevenLabs TTS WS; audio never
// transits the HK API. Returns accumulated MP3 chunks.
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
          const bytes = Uint8Array.from(atob(msg.audio), (c) => c.charCodeAt(0));
          chunks.push(bytes);
        }
        if (msg.isFinal) {
          try { ws.close(); } catch { /* noop */ }
          resolve(chunks);
        }
      } catch { /* noop */ }
    });
    ws.addEventListener('error', () => reject(new Error('TTS failed')));
    // Resolve with whatever chunks arrived if the connection closes early.
    ws.addEventListener('close', () => resolve(chunks));
  });
}

export function useVoiceSession(callbacks: VoiceSessionCallbacks): UseVoiceSessionResult {
  const [status, setStatus] = useState<VoiceSessionStatus>('idle');
  const [transcriptLines, setTranscriptLines] = useState<string[]>([]);
  const [lumiLines, setLumiLines] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const playingAudioRef = useRef<HTMLAudioElement | null>(null);
  const statusRef = useRef<VoiceSessionStatus>('idle');
  const startedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const processingRef = useRef(false);
  const callbacksRef = useRef(callbacks);
  useEffect(() => { callbacksRef.current = callbacks; });

  const setStatusBoth = useCallback((next: VoiceSessionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const playAudioChunks = useCallback(
    (chunks: Uint8Array[]) => {
      if (chunks.length === 0) {
        if (statusRef.current === 'speaking') setStatusBoth('ready');
        return;
      }
      if (playingAudioRef.current) {
        try { playingAudioRef.current.pause(); } catch { /* noop */ }
        playingAudioRef.current = null;
      }
      const blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      playingAudioRef.current = audio;
      setStatusBoth('speaking');
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(url);
        playingAudioRef.current = null;
        if (statusRef.current === 'speaking') setStatusBoth('ready');
      });
      audio.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        playingAudioRef.current = null;
      });
      void audio.play().catch(() => {
        URL.revokeObjectURL(url);
        playingAudioRef.current = null;
      });
    },
    [setStatusBoth],
  );

  const vad = useMicVAD({
    startOnLoad: false,
    onSpeechStart: () => {
      if (statusRef.current === 'ready') setStatusBoth('listening');
    },
    onSpeechEnd: (audio: Float32Array) => {
      if (!startedRef.current || processingRef.current) return;
      if (statusRef.current !== 'listening' && statusRef.current !== 'ready') return;
      processingRef.current = true;
      setStatusBoth('processing');

      void (async () => {
        try {
          let transcript: string;
          try {
            transcript = await transcribeAudio(audio);
          } catch {
            setStatusBoth('ready');
            return;
          }
          if (transcript.trim().length === 0) {
            setStatusBoth('ready');
            return;
          }
          setTranscriptLines((prev) => [...prev, transcript]);

          const sessionId = sessionIdRef.current;
          if (!sessionId || !startedRef.current) { setStatusBoth('ready'); return; }

          let result: {
            reply: string;
            complete: boolean;
            summary?: unknown;
            cultural_priors_detected?: boolean;
          };
          try {
            result = await hkFetch<typeof result>('/v1/voice/turns', {
              method: 'POST',
              body: { session_id: sessionId, transcript },
            });
          } catch {
            setStatusBoth('ready');
            return;
          }

          setLumiLines((prev) => [...prev, result.reply]);

          let chunks: Uint8Array[] = [];
          try {
            chunks = await fetchTtsChunks(result.reply);
          } catch { /* TTS failed — caption still shown */ }

          if (result.complete) {
            setStatusBoth('closing');
            callbacksRef.current.onComplete({
              cultural_priors_detected: result.cultural_priors_detected ?? false,
            });
          } else {
            playAudioChunks(chunks);
          }
        } finally {
          processingRef.current = false;
        }
      })();
    },
    positiveSpeechThreshold: 0.8,
    negativeSpeechThreshold: 0.6,
    minSpeechMs: 250,
    preSpeechPadMs: 300,
  });

  const stop = useCallback(() => {
    if (!startedRef.current) return;
    startedRef.current = false;
    try { vad.pause(); } catch { /* noop */ }
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) {
      void hkFetch<unknown>(`/v1/voice/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
    setStatusBoth('closed');
  }, [setStatusBoth, vad]);

  const start = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setErrorMessage(null);
    setStatusBoth('connecting');
    try {
      const raw = await hkFetch<unknown>('/v1/voice/sessions', {
        method: 'POST',
        body: { context: 'onboarding' },
      });
      if (!startedRef.current) return;
      const { session_id } = VoiceSessionCreateResponseSchema.parse(raw);
      sessionIdRef.current = session_id;
      setStatusBoth('ready');
      vad.start();
    } catch (err) {
      startedRef.current = false;
      const message =
        err instanceof Error ? err.message : 'Could not start voice session — please try again';
      setErrorMessage(message);
      setStatusBoth('error');
      callbacksRef.current.onError?.(message);
    }
  }, [setStatusBoth, vad]);

  useEffect(() => {
    return () => {
      if (startedRef.current) stop();
      if (playingAudioRef.current) {
        try { playingAudioRef.current.pause(); } catch { /* noop */ }
        playingAudioRef.current = null;
      }
    };
  }, [stop]);

  return { status, transcriptLines, lumiLines, errorMessage, start, stop };
}
