import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { AuditRepository } from '../audit/audit.repository.js';
import { AuditService } from '../audit/audit.service.js';

const auditHookPlugin: FastifyPluginAsync = async (fastify) => {
  const repository = new AuditRepository(fastify.supabase);
  const service = new AuditService(repository);

  fastify.addHook('onResponse', async (request) => {
    const ctx = request.auditContext;
    if (!ctx) return;
    void service.write(ctx).catch((err: unknown) => {
      request.log.error(
        { err, module: 'audit', action: 'audit.hook.write.failed' },
        'audit write failed — not propagated',
      );
    });
  });
};

export const auditHook = fp(auditHookPlugin, { name: 'audit-hook' });
