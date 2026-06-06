import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { ServerResponse } from 'node:http';

// Story 12-S12 — in-process SSE fan-out. The dispatcher keeps a registry of live
// `GET /v1/events` connections keyed by household so a background worker (the
// lumi-nudge job) can push an event to every open tab for a household without a
// request context. Single-node only: when Epic 5 (5-S1) adds Redis pub/sub, the
// `emit` body becomes a `PUBLISH` and callers stay unchanged behind this contract.
export interface SseDispatcher {
  register(householdId: string, res: ServerResponse): void;
  unregister(householdId: string, res: ServerResponse): void;
  emit(householdId: string, event: string, data: string): void;
}

declare module 'fastify' {
  interface FastifyInstance {
    sseDispatcher: SseDispatcher;
  }
}

const sseDispatcherFn: FastifyPluginAsync = async (fastify) => {
  const connections = new Map<string, Set<ServerResponse>>();

  fastify.decorate('sseDispatcher', {
    register(householdId, res) {
      if (!connections.has(householdId)) connections.set(householdId, new Set());
      connections.get(householdId)!.add(res);
    },
    unregister(householdId, res) {
      const set = connections.get(householdId);
      if (!set) return;
      set.delete(res);
      if (set.size === 0) connections.delete(householdId);
    },
    emit(householdId, event, data) {
      const set = connections.get(householdId);
      if (!set || set.size === 0) return;
      const payload = `event: ${event}\ndata: ${data}\n\n`;
      for (const res of set) {
        if (res.writableEnded) {
          set.delete(res);
          continue;
        }
        try {
          res.write(payload);
        } catch {
          set.delete(res);
        }
      }
      if (set.size === 0) connections.delete(householdId);
    },
  } satisfies SseDispatcher);
};

export const sseDispatcherPlugin = fp(sseDispatcherFn, { name: 'sse-dispatcher' });
