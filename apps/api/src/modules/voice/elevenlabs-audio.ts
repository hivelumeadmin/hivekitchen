import { Buffer } from 'node:buffer';
import type { WebSocket } from '@fastify/websocket';
import { UpstreamError } from '../../common/errors.js';

// Story 5-S5b — the two stateless ElevenLabs audio calls, extracted so BOTH the
// onboarding voice path (VoiceService) and the ambient Lumi voice path
// (LumiService) share exactly ONE Scribe/TTS fetch implementation. These are
// pure functions over (apiKey, …); they hold no session state. ElevenLabs is
// used here as two stateless audio services only — Scribe STT (REST) + TTS —
// with no Conversational AI agent.

// STT — ElevenLabs Scribe (`scribe_v1`) over REST `POST /v1/speech-to-text`.
// Takes a complete WAV utterance (16 kHz mono) and returns the transcript text.
export async function transcribeWav(apiKey: string, wav: Buffer): Promise<string> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(wav)], { type: 'audio/wav' });
  form.append('audio', blob, 'utterance.wav');
  form.append('model_id', 'scribe_v1');

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });

  if (!res.ok) {
    throw new UpstreamError(`ElevenLabs STT failed: HTTP ${res.status}`);
  }

  const json = (await res.json()) as { text?: unknown };
  if (typeof json.text !== 'string') {
    throw new UpstreamError('ElevenLabs STT returned no transcript text');
  }
  return json.text;
}

// TTS — ElevenLabs `POST /v1/text-to-speech/{voice}/stream` (`eleven_v3`,
// `mp3_44100_128`). Streams the synthesized audio and forwards each chunk to the
// browser as a binary WebSocket frame. Raw audio never transits OpenAI and is
// never persisted.
export async function streamTtsToWs(
  apiKey: string,
  voiceId: string,
  text: string,
  ws: WebSocket,
): Promise<void> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_v3',
        output_format: 'mp3_44100_128',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.6,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!res.ok || res.body === null) {
    throw new UpstreamError(`ElevenLabs TTS failed: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        ws.send(Buffer.from(value));
      }
    }
  } finally {
    reader.cancel().catch(() => {
      /* noop */
    });
  }
}
