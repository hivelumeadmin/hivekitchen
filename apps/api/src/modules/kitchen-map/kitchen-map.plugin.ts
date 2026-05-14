import { Buffer } from 'node:buffer';
import fp from 'fastify-plugin';
import { KitchenMapRepository } from './kitchen-map.repository.js';
import { KitchenMapService } from './kitchen-map.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    kitchenMapService: KitchenMapService;
  }
}

/**
 * Slice A0.5 — wires the KitchenMapService.
 *
 * Must run AFTER: supabase, redis (ioredisPlugin), env validation.
 * Provides: fastify.kitchenMapService
 *
 * KEK source: ENVELOPE_ENCRYPTION_MASTER_KEY env var. When unset
 * (development without secrets), the service still runs — encrypted child
 * columns fall through as-stored, which is fine for non-onboarded local
 * scenarios. Per-row decryption failures are isolated (one corrupt child
 * row doesn't crash the whole map).
 */
export const kitchenMapPlugin = fp(async (fastify) => {
  const kekHex = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY;
  const kek = kekHex ? Buffer.from(kekHex, 'hex') : null;

  const repository = new KitchenMapRepository(fastify.supabase, kek, fastify.log);
  const service = new KitchenMapService({
    repository,
    redis: fastify.redis,
    logger: fastify.log,
  });

  fastify.decorate('kitchenMapService', service);
});
