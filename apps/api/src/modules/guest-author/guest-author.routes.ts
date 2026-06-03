import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { GuestAuthorCapResponseSchema } from '@hivekitchen/contracts';
import { authorize } from '../../middleware/authorize.hook.js';
import { NotFoundError } from '../../common/errors.js';
import { HeartNoteRepository } from '../heart-notes/heart-note.repository.js';
import { GUEST_AUTHOR_CAP } from '../heart-notes/heart-note.routes.js';

// Recognised grandparent terms (lowercased for matching). The detected term is
// underlined in sacred-plum in the composer's rhythm copy (cultural recognition,
// UX-DR22) — never applied to the Heart Note content itself.
const FAMILY_TERMS = ['nani', 'dadi', 'lola', 'bibi'] as const;

const guestAuthorRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  // countAuthoredThisMonth is a count-only query — no content decrypt, so no
  // DEK/KEK is needed and the repo is constructed with a null key.
  const repository = new HeartNoteRepository(fastify.supabase, null);

  fastify.get(
    '/v1/guest-author/cap',
    {
      preHandler: [authorize(['guest_author'])],
      schema: { response: { 200: GuestAuthorCapResponseSchema } },
    },
    async (request, reply) => {
      const { data: childData, error: childErr } = await fastify.supabase
        .from('children')
        .select('id, name')
        .eq('household_id', request.user.household_id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (childErr) throw childErr;
      if (!childData) throw new NotFoundError('no child found in household');
      const child = childData as { id: string; name: string };

      const { data: userData, error: userErr } = await fastify.supabase
        .from('users')
        .select('display_name')
        .eq('id', request.user.id)
        .maybeSingle();
      if (userErr) throw userErr;
      const displayName = (userData as { display_name: string | null } | null)?.display_name ?? 'Guest';

      const notesUsed = await repository.countAuthoredThisMonth(
        request.user.id,
        request.user.household_id,
      );

      return reply.send({
        child_id: child.id,
        child_name: child.name,
        grandparent_name: displayName,
        grandparent_term: detectFamilyTerm(displayName),
        notes_used: notesUsed,
        cap: GUEST_AUTHOR_CAP,
        next_month_opens: nextMonthFirstWeekday(new Date()),
      });
    },
  );
};

// Detects a family term inside the display_name, preserving its original case
// (e.g. "Nani Ayaan" → "Nani"). Returns null when no term is present.
function detectFamilyTerm(displayName: string | null): string | null {
  if (!displayName) return null;
  const lower = displayName.toLowerCase();
  const term = FAMILY_TERMS.find((t) => lower.includes(t));
  if (!term) return null;
  return displayName.match(new RegExp(term, 'i'))?.[0] ?? null;
}

// First weekday (Mon–Fri) of next calendar month, as YYYY-MM-DD (UTC). When the
// 1st falls on a weekend, advances to the following Monday.
function nextMonthFirstWeekday(now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const firstOfNext = new Date(Date.UTC(year, month + 1, 1));
  const dow = firstOfNext.getUTCDay(); // 0=Sun, 6=Sat
  const daysToAdd = dow === 0 ? 1 : dow === 6 ? 2 : 0;
  firstOfNext.setUTCDate(firstOfNext.getUTCDate() + daysToAdd);
  return firstOfNext.toISOString().split('T')[0]!;
}

export const guestAuthorRoutes = fp(guestAuthorRoutesPlugin, { name: 'guest-author-routes' });
