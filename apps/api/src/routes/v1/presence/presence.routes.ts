import fp from 'fastify-plugin';
import type { z } from 'zod';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { PresenceHeartbeatRequestSchema, PresenceResponseSchema } from '@hivekitchen/contracts';
import type { PresencePartner, SurfaceKind } from '@hivekitchen/types';
import { UserRepository } from '../../../modules/users/user.repository.js';
import { emitPresenceEvent, getPresenceKey } from '../../../modules/presence/presence.helpers.js';

const PRESENCE_TTL_SECONDS = 60;

interface StoredPresence {
  display_name: string | null;
  surface: SurfaceKind;
  expires_at: string;
}

// Read every household member's presence, excluding the requester.
// TODO(Epic 9): replace KEYS with a SCAN cursor — fine at beta scale (≤2
// members per household), but KEYS blocks the Redis event loop at scale.
async function getPartners(
  fastify: FastifyInstance,
  householdId: string,
  excludeUserId: string,
): Promise<PresencePartner[]> {
  const keys = await fastify.redis.keys(`presence:${householdId}:*`);
  const partners: PresencePartner[] = [];
  for (const key of keys) {
    if (key.endsWith(`:${excludeUserId}`)) continue;
    const raw = await fastify.redis.get(key);
    if (!raw) continue;
    let parsed: StoredPresence;
    try {
      parsed = JSON.parse(raw) as StoredPresence;
    } catch {
      fastify.log.warn({ key }, 'presence: skipping corrupt Redis value');
      continue;
    }
    const userId = key.split(':').pop()!;
    partners.push({
      user_id: userId,
      display_name: parsed.display_name,
      surface: parsed.surface,
      expires_at: parsed.expires_at,
    });
  }
  return partners;
}

const presenceRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const userRepository = new UserRepository(fastify.supabase);

  fastify.get(
    '/v1/presence',
    { schema: { response: { 200: PresenceResponseSchema } } },
    async (request, reply) => {
      const { household_id: householdId, id: userId } = request.user;
      const partners = await getPartners(fastify, householdId, userId);
      return reply.send({ partners });
    },
  );

  fastify.post(
    '/v1/presence/heartbeat',
    {
      schema: {
        body: PresenceHeartbeatRequestSchema,
        response: { 200: PresenceResponseSchema },
      },
    },
    async (request, reply) => {
      const { household_id: householdId, id: userId } = request.user;
      const { surface } = request.body as z.infer<typeof PresenceHeartbeatRequestSchema>;

      const profile = await userRepository.findUserById(userId);
      const expiresAt = new Date(Date.now() + PRESENCE_TTL_SECONDS * 1000).toISOString();
      const value: StoredPresence = {
        display_name: profile?.display_name ?? null,
        surface,
        expires_at: expiresAt,
      };
      await fastify.redis.set(
        getPresenceKey(householdId, userId),
        JSON.stringify(value),
        'EX',
        PRESENCE_TTL_SECONDS,
      );

      emitPresenceEvent(fastify, householdId, userId, surface, expiresAt);

      const partners = await getPartners(fastify, householdId, userId);
      return reply.send({ partners });
    },
  );

  fastify.delete('/v1/presence', async (request, reply) => {
    const { household_id: householdId, id: userId } = request.user;
    const key = getPresenceKey(householdId, userId);

    const raw = await fastify.redis.get(key);
    if (raw) {
      const stored = JSON.parse(raw) as StoredPresence;
      await fastify.redis.del(key);
      const expiredAt = new Date(Date.now() - 1000).toISOString();
      emitPresenceEvent(fastify, householdId, userId, stored.surface, expiredAt);
    }

    return reply.status(204).send();
  });
};

export const presenceRoutes = fp(presenceRoutesPlugin, { name: 'presence-routes' });
