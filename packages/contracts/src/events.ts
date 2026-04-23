import { z } from "zod";

export const SSEEvent = z.object({
  type: z.enum([
    "voice.session.started",
    "voice.session.ended",
    "voice.session.disconnected",
    "ui.tool.active",
    "ui.tool.complete",
    "transcript.updated",
    "plan.created",
    "plan.updated",
    "list.updated",
  ]),
  payload: z.record(z.unknown()),
  timestamp: z.string().datetime(),
});
