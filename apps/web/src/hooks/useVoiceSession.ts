import { useCallback, useEffect, useRef, useState } from 'react';
import { useMicVAD } from '@ricky0123/vad-react';
import {
  VoiceSessionCreateResponseSchema,
  WsServerMessageSchema,
  type WsServerMessage,
} from '@hivekitchen/contracts';
import { hkFetch } from '@/lib/fetch.js';
import { encodeWav } from '@/lib/encodeWav.js';
import { useAuthStore } from '@/stores/auth.store.js';

const WS_BASE_URL = import.meta.env.VITE_API_WS_URL;

export type VoiceSessionStatus =
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

interface ChunkBuffer {
  seq: number;
  chunks: Uint8Array[];
}

export function useVoiceSession(callbacks: VoiceSessionCallbacks): UseVoiceSessionResult {
  const [status, setStatus] = useState<VoiceSessionStatus>('idle');
  const [transcriptLines, setTranscriptLines] = useState<string[]>([]);
  const [lumiLines, setLumiLines] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioBufferRef = useRef<ChunkBuffer | null>(null);
  const playingAudioRef = useRef<HTMLAudioElement | null>(null);
  const statusRef = useRef<VoiceSessionStatus>('idle');
  const startedRef = useRef(false);
  const callbacksRef = useRef(callbacks);
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => { callbacksRef.current = callbacks; });

  const setStatusBoth = useCallback((next: VoiceSessionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const playBufferedAudio = useCallback(() => {
    const buf = audioBufferRef.current;
    if (!buf) return;
    if (buf.chunks.length === 0) {
      if (statusRef.current === 'processing') setStatusBoth('ready');
      return;
    }
    if (playingAudioRef.current) {
      try { playingAudioRef.current.pause(); } catch { /* noop */ }
      playingAudioRef.current = null;
    }
    const blob = new Blob(buf.chunks as BlobPart[], { type: 'audio/mpeg' });
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
    audioBufferRef.current = null;
  }, [setStatusBoth]);

  const handleServerMessage = useCallback(
    (msg: WsServerMessage) => {
      switch (msg.type) {
        case 'session.ready':
          setStatusBoth('ready');
          return;
        case 'transcript':
          setTranscriptLines((prev) => [...prev, msg.text]);
          return;
        case 'response.start':
          audioBufferRef.current = { seq: msg.seq, chunks: [] };
          return;
        case 'response.end':
          setLumiLines((prev) => [...prev, msg.text]);
          playBufferedAudio();
          return;
        case 'session.summary':
          setStatusBoth('closing');
          callbacksRef.current.onComplete({ cultural_priors_detected: msg.cultural_priors_detected });
          return;
        case 'error':
          setErrorMessage(msg.message);
          callbacksRef.current.onError?.(msg.message);
          return;
      }
    },
    [playBufferedAudio, setStatusBoth],
  );

  const vad = useMicVAD({
    startOnLoad: false,
    onSpeechStart: () => {
      if (statusRef.current === 'ready') setStatusBoth('listening');
    },
    onSpeechEnd: (audio: Float32Array) => {
      const ws = wsRef.current;
      if (ws === null || ws.readyState !== WebSocket.OPEN) return;
      // Server-side concurrent-frame protection (Story 2.6b AC4) is the
      // authoritative guard; this is a defensive client-side guard so we do
      // not stream audio while Lumi is mid-response.
      if (statusRef.current !== 'listening' && statusRef.current !== 'ready') return;
      const wav = encodeWav(audio, 16000);
      // Copy into a fresh ArrayBuffer so WS.send receives a plain ArrayBuffer
      // (Uint8Array.buffer can be a SharedArrayBuffer in some runtimes).
      const ab = new ArrayBuffer(wav.byteLength);
      new Uint8Array(ab).set(wav);
      ws.send(ab);
      setStatusBoth('processing');
    },
    positiveSpeechThreshold: 0.8,
    negativeSpeechThreshold: 0.6,
    minSpeechMs: 250,
    preSpeechPadMs: 300,
  });

  const stop = useCallback(() => {
    if (!startedRef.current) return;
    startedRef.current = false;
    try {
      vad.pause();
    } catch {
      /* noop */
    }
    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close(1000, 'client end');
      } catch {
        /* noop */
      }
    }
    wsRef.current = null;
    setStatusBoth('closed');
  }, [setStatusBoth, vad]);

  useEffect(() => { stopRef.current = stop; });

  const start = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setErrorMessage(null);
    setStatusBoth('connecting');
    try {
      if (!WS_BASE_URL) {
        throw new Error('VITE_API_WS_URL is not configured');
      }
      const raw = await hkFetch<unknown>('/v1/voice/sessions', {
        method: 'POST',
        body: { context: 'onboarding' },
      });
      if (!startedRef.current) return;
      const { session_id } = VoiceSessionCreateResponseSchema.parse(raw);
      const accessToken = useAuthStore.getState().accessToken;
      if (accessToken === null) {
        throw new Error('Missing access token');
      }
      const ws = new WebSocket(
        `${WS_BASE_URL}/v1/voice/ws?session_id=${encodeURIComponent(session_id)}&token=${encodeURIComponent(accessToken)}`,
      );
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.addEventListener('message', (ev) => {
        if (typeof ev.data === 'string') {
          let parsed: unknown;
          try {
            parsed = JSON.parse(ev.data);
          } catch {
            return;
          }
          const result = WsServerMessageSchema.safeParse(parsed);
          if (!result.success) return;
          handleServerMessage(result.data);
          return;
        }
        // Binary — MP3 chunk for the in-flight Lumi response
        const buf = audioBufferRef.current;
        if (!buf) return;
        if (ev.data instanceof ArrayBuffer) {
          if (audioBufferRef.current?.seq === buf.seq) {
            buf.chunks.push(new Uint8Array(ev.data));
          }
        } else if (ev.data instanceof Blob) {
          void ev.data.arrayBuffer().then((ab) => {
            const b = audioBufferRef.current;
            if (b && b.seq === buf.seq) b.chunks.push(new Uint8Array(ab));
          });
        }
      });

      ws.addEventListener('close', () => {
        if (statusRef.current !== 'closing' && statusRef.current !== 'closed') {
          setStatusBoth('closed');
        }
      });

      ws.addEventListener('error', () => {
        setErrorMessage('Voice connection error');
        setStatusBoth('error');
        callbacksRef.current.onError?.('Voice connection error');
      });

      vad.start();
    } catch (err) {
      startedRef.current = false;
      const message =
        err instanceof Error ? err.message : 'Could not start voice session — please try again';
      setErrorMessage(message);
      setStatusBoth('error');
      callbacksRef.current.onError?.(message);
    }
  }, [handleServerMessage, setStatusBoth, vad]);

  useEffect(() => {
    return () => {
      if (startedRef.current) stopRef.current();
      if (playingAudioRef.current) {
        try {
          playingAudioRef.current.pause();
        } catch {
          /* noop */
        }
        playingAudioRef.current = null;
      }
    };
  }, []);

  return { status, transcriptLines, lumiLines, errorMessage, start, stop };
}
