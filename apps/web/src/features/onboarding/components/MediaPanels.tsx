import { useCallback, useEffect, useRef, useState } from 'react';
import { PauseCircleIcon, PlayArrowIcon } from '@hivekitchen/ui';
import { hkFetch } from '../../../lib/fetch.js';

interface Readonly_VideoPanelProps {
  readonly imageSrc: string;
  readonly imageAlt: string;
}

export type VideoPanelProps = Readonly<Readonly_VideoPanelProps>;

export function VideoPanel({ imageSrc, imageAlt }: VideoPanelProps) {
  return (
    <div className="group relative aspect-video w-full cursor-pointer overflow-hidden rounded-2xl border border-border/20 bg-surface shadow-2xl shadow-black/50">
      <img
        src={imageSrc}
        alt={imageAlt}
        className="h-full w-full object-cover opacity-60 transition-transform duration-700 ease-out group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-bg/30 transition-colors duration-500 group-hover:bg-bg/10" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-amber-warm/30 bg-amber-warm/20 backdrop-blur-md transition-all duration-300 group-hover:scale-110 group-hover:bg-amber-warm/30">
          <PlayArrowIcon className="ms-1 h-10 w-10 text-amber-warm" />
        </div>
      </div>
    </div>
  );
}

interface Readonly_AudioPanelProps {
  readonly caption: string;
  /** Text Lumi will narrate. Pass the same paragraphs the "Read Text" tab shows. */
  readonly text: string;
}

export type AudioPanelProps = Readonly<Readonly_AudioPanelProps>;

type AudioStatus = 'idle' | 'connecting' | 'playing' | 'paused' | 'error';

interface TtsTokenResponse {
  token: string;
  voice_id: string;
  model_id: string;
}

/**
 * Slice 2-S20 — "Listen to Lumi" tab, browser-direct via ElevenLabs TTS
 * WebSocket using a single-use token. The HK API mints a short-lived token
 * (POST /v1/voice/tts/token); we open the WS direct to ElevenLabs. Raw
 * audio never transits the HK API; the long-lived xi-api-key stays
 * server-side.
 *
 * Protocol (ElevenLabs TTS WebSocket — stream-input):
 *   1. Open WS to wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 *      /stream-input?single_use_token=<token>&model_id=<model>
 *      &output_format=pcm_16000
 *   2. Send an init message with voice settings + a leading space:
 *        { text: " ", voice_settings: {...}, generation_config: {...} }
 *   3. Send the actual text:
 *        { text: "<the copy>" }
 *   4. Send the end-of-input sentinel to flush + close server-side:
 *        { text: "" }
 *   5. Receive audio messages: { audio: "<base64 PCM>", isFinal?: boolean }
 *      Decode + queue chunks through the Web Audio API.
 *   6. When isFinal=true arrives (or socket closes normally), wait out the
 *      remaining scheduled playback and transition to paused.
 */
export function AudioPanel({ caption, text }: AudioPanelProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Sample rate of the inbound PCM stream — the narration TTS WebSocket emits
  // 16 kHz pcm_16000. If we override `output_format` in the init message we
  // must update this.
  const sampleRateRef = useRef<number>(16000);
  // Time pointer for scheduling chunk playback contiguously via Web Audio API.
  const nextPlayTimeRef = useRef<number>(0);
  // The most recently scheduled BufferSource — used to pause/resume by
  // tearing down and rebuilding the AudioContext.
  const lastSourceRef = useRef<AudioBufferSourceNode | null>(null);
  // Tracks whether we received any audio bytes during the current WS lifetime.
  // Used in the close handler to decide whether to surface an error — read
  // from a ref because the close callback closes over a stale `status` state.
  const heardAudioRef = useRef<boolean>(false);
  // Tracks whether the server sent isFinal=true during the current WS lifetime.
  // Used in the close handler to detect a normal close without isFinal (truncated stream).
  const isFinalReceivedRef = useRef<boolean>(false);
  const [status, setStatus] = useState<AudioStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cleanup = useCallback(() => {
    if (wsRef.current !== null) {
      try { wsRef.current.close(1000, 'panel cleanup'); } catch { /* noop */ }
      wsRef.current = null;
    }
    if (audioCtxRef.current !== null) {
      try { void audioCtxRef.current.close(); } catch { /* noop */ }
      audioCtxRef.current = null;
    }
    lastSourceRef.current = null;
    nextPlayTimeRef.current = 0;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const playAudioChunk = useCallback((base64: string) => {
    const ctx = audioCtxRef.current;
    if (ctx === null) return;

    // base64 → Uint8Array → Int16Array (PCM 16-bit signed little-endian)
    let binary: string;
    try {
      binary = atob(base64);
    } catch {
      return;
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);

    // Int16 PCM → Float32 [-1, 1] for AudioBuffer
    const float = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) float[i] = pcm[i]! / 0x8000;

    if (float.length === 0) return;

    const buffer = ctx.createBuffer(1, float.length, sampleRateRef.current);
    buffer.copyToChannel(float, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Schedule contiguous playback: each chunk starts where the last ended.
    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
    lastSourceRef.current = source;
  }, []);

  const startPlayback = useCallback(async () => {
    if (status === 'connecting' || status === 'playing') return;
    cleanup();
    setStatus('connecting');
    setErrorMessage(null);

    try {
      // 1. Mint a single-use token from HK API (HTTP, no audio).
      const { token, voice_id, model_id } = await hkFetch<TtsTokenResponse>(
        '/v1/voice/tts/token',
        { method: 'POST' },
      );

      // 2. Open WS direct to ElevenLabs TTS stream-input. Output is pinned
      //    to pcm_16000 to match sampleRateRef and our Int16-LE decode path.
      const params = new URLSearchParams({
        single_use_token: token,
        model_id,
        output_format: 'pcm_16000',
      });
      const wsUrl =
        `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice_id)}` +
        `/stream-input?${params.toString()}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        // Init audio context lazily so playback respects the user gesture
        // (browsers gate autoplay on user interaction).
        audioCtxRef.current = new AudioContext({ sampleRate: sampleRateRef.current });
        void audioCtxRef.current.resume();
        nextPlayTimeRef.current = 0;
        heardAudioRef.current = false;
        isFinalReceivedRef.current = false;

        // 3. Init message — ElevenLabs TTS WS convention is to send a
        //    leading space first along with voice settings + generation
        //    config. The server uses this to set per-session params; the
        //    space is ignored as content.
        ws.send(JSON.stringify({
          text: ' ',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
          },
          generation_config: {
            chunk_length_schedule: [120, 160, 250, 290],
          },
        }));

        // 4. The actual narration text.
        ws.send(JSON.stringify({ text }));

        // 5. End-of-input sentinel — flushes the server to finalize audio
        //    and emit isFinal=true, after which it closes the socket.
        ws.send(JSON.stringify({ text: '' }));
      });

      ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        let msg: unknown;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (typeof msg !== 'object' || msg === null) return;
        const m = msg as { audio?: unknown; isFinal?: unknown; error?: unknown };

        if (typeof m.error === 'string' && m.error.length > 0) {
          setStatus('error');
          setErrorMessage(m.error);
          return;
        }

        if (typeof m.audio === 'string' && m.audio.length > 0) {
          heardAudioRef.current = true;
          setStatus('playing');
          playAudioChunk(m.audio);
        }

        if (m.isFinal === true) {
          isFinalReceivedRef.current = true;
          // Server has emitted all audio. Wait out remaining scheduled
          // playback then close + transition to idle.
          const remaining = Math.max(
            0,
            (nextPlayTimeRef.current - (audioCtxRef.current?.currentTime ?? 0)) * 1000,
          );
          setTimeout(() => {
            try { ws.close(1000, 'narration complete'); } catch { /* noop */ }
            setStatus('idle');
          }, remaining + 250);
        }
      });

      ws.addEventListener('error', () => {
        setStatus('error');
        setErrorMessage('Connection to Lumi failed');
      });

      ws.addEventListener('close', (e) => {
        if (e.code !== 1000 && !heardAudioRef.current) {
          // Closed abnormally before any audio arrived — surface as error.
          setStatus('error');
          setErrorMessage(`Connection closed (${e.code})`);
        } else if (!isFinalReceivedRef.current) {
          // Closed (normally or not) before isFinal — reset to idle rather than hang.
          setStatus('idle');
        }
        // isFinal handler already set status when isFinalReceivedRef is true.
      });
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Could not start Lumi');
      cleanup();
    }
  }, [status, text, playAudioChunk, cleanup]);

  const onToggle = useCallback(() => {
    if (status === 'playing') {
      // Pause = tear down the audio context. Re-tapping play starts a fresh
      // session (re-bills ElevenLabs). Acceptable for v1; chunk-buffer-and-
      // resume is a follow-up if usage data justifies it.
      cleanup();
      setStatus('paused');
      return;
    }
    void startPlayback();
  }, [status, startPlayback, cleanup]);

  const isPlaying = status === 'playing';
  const isConnecting = status === 'connecting';
  const statusLabel = (() => {
    if (status === 'connecting') return 'Connecting to Lumi…';
    if (status === 'playing') return 'Playing audio overview';
    if (status === 'paused') return 'Paused';
    if (status === 'error') return errorMessage ?? 'Audio unavailable';
    return 'Tap play to hear Lumi read this aloud';
  })();

  return (
    <div className="flex w-full flex-col items-center justify-center space-y-8 rounded-2xl border border-border/20 bg-surface p-12 shadow-xl">
      <div
        className="flex h-16 items-center justify-center gap-1.5"
        aria-hidden="true"
      >
        <span
          className={`h-6 w-1.5 rounded-full bg-lumi-terracotta/40 [animation-delay:100ms] [animation-duration:1s] ${isPlaying ? 'animate-bounce' : ''}`}
        />
        <span
          className={`h-12 w-1.5 rounded-full bg-lumi-terracotta/70 [animation-delay:200ms] [animation-duration:1.2s] ${isPlaying ? 'animate-bounce' : ''}`}
        />
        <span
          className={`h-16 w-1.5 rounded-full bg-lumi-terracotta [animation-delay:300ms] [animation-duration:0.8s] ${isPlaying ? 'animate-bounce' : ''}`}
        />
        <span
          className={`h-10 w-1.5 rounded-full bg-lumi-terracotta/70 [animation-delay:400ms] [animation-duration:1.1s] ${isPlaying ? 'animate-bounce' : ''}`}
        />
        <span
          className={`h-8 w-1.5 rounded-full bg-lumi-terracotta/40 [animation-delay:500ms] [animation-duration:0.9s] ${isPlaying ? 'animate-bounce' : ''}`}
        />
      </div>

      <button
        type="button"
        onClick={onToggle}
        disabled={isConnecting}
        aria-label={isPlaying ? 'Pause Lumi' : 'Listen to Lumi'}
        className="flex h-16 w-16 items-center justify-center rounded-full border border-amber-warm/30 bg-amber-warm/20 text-amber-warm transition-all duration-300 hover:scale-110 hover:bg-amber-warm/30 disabled:opacity-50 disabled:cursor-wait"
      >
        {isPlaying ? (
          <PauseCircleIcon className="h-8 w-8" />
        ) : (
          <PlayArrowIcon className="ms-1 h-8 w-8" />
        )}
      </button>

      <div className="space-y-3 text-center">
        <p className="font-serif text-2xl font-light italic text-fg">{caption}</p>
        <p
          className="text-sm uppercase tracking-widest text-fg-muted/60"
          role="status"
          aria-live="polite"
        >
          {statusLabel}
        </p>
      </div>
    </div>
  );
}

interface Readonly_TextPanelProps {
  readonly paragraphs: readonly string[];
}

export type TextPanelProps = Readonly<Readonly_TextPanelProps>;

export function TextPanel({ paragraphs }: TextPanelProps) {
  return (
    <div className="space-y-10">
      {paragraphs.map((p, i) => (
        <div key={i} className="space-y-10">
          <p className="text-[15px] leading-relaxed text-fg-muted">{p}</p>
          {i < paragraphs.length - 1 ? <hr className="border-t border-border/20" /> : null}
        </div>
      ))}
    </div>
  );
}
