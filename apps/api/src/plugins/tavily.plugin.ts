import fp from 'fastify-plugin';
import { createTavilyClient } from '../lib/tavily.js';

// Story 3-31 — Tavily client decorator. Backs RecipeAgent.discover's
// web-search path. Same shape as openaiPlugin: one shared client, env-
// driven API key, no per-request state.

export const tavilyPlugin = fp(async (fastify) => {
  if (!fastify.env) {
    throw new Error('tavilyPlugin requires env decorator — register envPlugin first');
  }
  const client = createTavilyClient(fastify.env.TAVILY_API_KEY);
  fastify.decorate('tavily', client);
});
