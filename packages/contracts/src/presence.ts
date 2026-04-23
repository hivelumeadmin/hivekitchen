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
  expires_at: z.string().datetime(),
});
