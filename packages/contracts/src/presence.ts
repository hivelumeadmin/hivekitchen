import { z } from 'zod';

export const SurfaceKind = z.enum([
  'brief',
  'plan_tile',
  'lunch_link',
  'heart_note_composer',
  'thread',
  'memory_node',
]);

export const PresenceEvent = z.object({
  type: z.literal('presence.partner-active'),
  thread_id: z.string().uuid(),
  user_id: z.string().uuid(),
  surface: SurfaceKind,
  expires_at: z.string().datetime({ offset: true }),
});

// Story 5-S1 — presence REST surface.
export const PresenceHeartbeatRequestSchema = z.object({
  surface: SurfaceKind,
});

export const PresencePartnerSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  surface: SurfaceKind,
  expires_at: z.string().datetime({ offset: true }),
});

export const PresenceResponseSchema = z.object({
  partners: z.array(PresencePartnerSchema),
});

export type PresenceHeartbeatRequest = z.infer<typeof PresenceHeartbeatRequestSchema>;
export type PresencePartner = z.infer<typeof PresencePartnerSchema>;
export type PresenceResponse = z.infer<typeof PresenceResponseSchema>;
