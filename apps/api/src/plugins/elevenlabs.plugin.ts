import fp from 'fastify-plugin';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

export const elevenlabsPlugin = fp(async (fastify) => {
  const client = new ElevenLabsClient({ apiKey: fastify.env.ELEVENLABS_API_KEY });
  fastify.decorate('elevenlabs', client);
});
