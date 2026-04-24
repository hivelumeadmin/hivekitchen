import fp from 'fastify-plugin';
import { shutdownOtel } from '../observability/otel.js';

export const otelPlugin = fp(
  async (fastify) => {
    fastify.addHook('onClose', async () => {
      await shutdownOtel();
    });
  },
  { name: 'otel' },
);
