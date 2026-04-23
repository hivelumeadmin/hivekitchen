import { z } from "zod";

export const ThreadTurn = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  modality: z.enum(["text", "voice"]),
  timestamp: z.string().datetime(),
});

export const Thread = z.object({
  id: z.string().uuid(),
  turns: z.array(ThreadTurn),
});
