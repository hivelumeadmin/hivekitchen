import { z } from 'zod';

// Slice 4-S13 — Grandparent Guest Author monthly cap, surfaced to the composer
// so it can render the at-cap "rhythm copy" (a heartbeat, not a restriction)
// rather than only learning about the cap from a rejected POST.
export const GuestAuthorCapResponseSchema = z.object({
  child_id: z.string().uuid(),
  child_name: z.string(),
  // users.display_name of the calling guest_author.
  grandparent_name: z.string(),
  // Family term ('Nani'|'Dadi'|'Lola'|'Bibi') if detected in display_name; else null.
  grandparent_term: z.string().nullable(),
  // Non-cancelled notes created this calendar month by this user.
  notes_used: z.number().int().min(0),
  cap: z.number().int(),
  // YYYY-MM-DD — first weekday (Mon–Fri) of next calendar month.
  next_month_opens: z.string(),
});

export type GuestAuthorCapResponse = z.infer<typeof GuestAuthorCapResponseSchema>;
