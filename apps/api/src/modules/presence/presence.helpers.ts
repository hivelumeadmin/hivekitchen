import type { FastifyInstance } from 'fastify';
import type { SurfaceKind } from '@hivekitchen/types';

// Redis key for a user's presence within a household. Value is JSON
// { display_name, surface, expires_at }; TTL 60s.
export function getPresenceKey(householdId: string, userId: string): string {
  return `presence:${householdId}:${userId}`;
}

// Emit a `presence.partner-active` SSE event to every open tab for the
// household. Extracted here so both presence.routes.ts and events.routes.ts
// (SSE disconnect cleanup) can call it without a routes→routes import cycle.
//
// Story 5-S1 SPEC RECONCILIATION: PresenceEvent requires `thread_id` (a UUID);
// the family thread ships in 5-S3. Until then we use `householdId` as the
// presence namespace — it is a valid UUID and matches the client's
// QueryKeys.presence(householdId) cache key.
export function emitPresenceEvent(
  fastify: FastifyInstance,
  householdId: string,
  userId: string,
  surface: SurfaceKind,
  expiresAt: string,
): void {
  const event = {
    type: 'presence.partner-active',
    thread_id: householdId,
    user_id: userId,
    surface,
    expires_at: expiresAt,
  };
  fastify.sseDispatcher.emit(householdId, 'message', JSON.stringify(event));
}
