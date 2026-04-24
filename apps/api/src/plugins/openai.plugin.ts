import fp from 'fastify-plugin';
import OpenAI from 'openai';

export const openaiPlugin = fp(async (fastify) => {
  const client = new OpenAI({ apiKey: fastify.env.OPENAI_API_KEY });
  fastify.decorate('openai', client);
});
