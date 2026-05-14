import fp from 'fastify-plugin';
import { VocabularyRepository } from './vocabulary.repository.js';
import { VocabularyService } from './vocabulary.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    vocabularyService: VocabularyService;
  }
}

/**
 * Slice A0.5 — registers the VocabularyService and pre-loads the four
 * vocabulary tables before any route is registered. Must run AFTER the
 * supabase plugin and BEFORE any plugin whose service validates tag
 * arrays (recipes, children, allergy guardrail's parent-declared path,
 * etc.).
 */
export const vocabularyPlugin = fp(async (fastify) => {
  const repository = new VocabularyRepository(fastify.supabase);
  const service = new VocabularyService(repository, fastify.log);
  await service.load();
  fastify.decorate('vocabularyService', service);
});
