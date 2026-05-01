import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { MemoryRepository } from './memory.repository.js';
import { MemoryService } from './memory.service.js';

const memoryHookPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new MemoryRepository(fastify.supabase);
  const service = new MemoryService({
    repository,
    logger: fastify.log,
    audit: fastify.auditService,
  });
  fastify.decorate('memoryService', service);
};

export const memoryHook = fp(memoryHookPlugin, { name: 'memory-hook' });
