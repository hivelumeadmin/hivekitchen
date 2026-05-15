import fp from 'fastify-plugin';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Auth-flow supabase client. AuthService uses this for
     *  signInWithPassword / exchangeCodeForSession / getUser-from-token /
     *  admin.updateUserById / admin.signOut.
     *
     *  Why this is separate from `fastify.supabase`: supabase-js v2 routes
     *  the Authorization header through the client's in-memory session
     *  state once a session has been set (which any successful auth call
     *  does). A single shared client would then send the LAST logged-in
     *  user's JWT on every subsequent .from(...) DB call, masquerading
     *  as the user and silently killing service-role RLS bypass —
     *  surfacing as `42501: new row violates row-level security policy`
     *  on writes to any table without an explicit INSERT policy for the
     *  `authenticated` role.
     *
     *  NEVER call .auth.signXxx() or .auth.exchangeXxx() on
     *  fastify.supabase. Use fastify.supabaseAuth for any auth-flow
     *  operation. */
    supabaseAuth: SupabaseClient;
  }
}

export const supabasePlugin = fp(async (fastify) => {
  // Two clients with the SAME service-role key but separate auth state.
  // See the FastifyInstance.supabaseAuth doc comment above for the full
  // rationale — short version: shared auth state across DB ops + login
  // pollutes the Authorization header and breaks RLS bypass.
  const supabase = createClient(
    fastify.env.SUPABASE_URL,
    fastify.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const supabaseAuth = createClient(
    fastify.env.SUPABASE_URL,
    fastify.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  fastify.decorate('supabase', supabase);
  fastify.decorate('supabaseAuth', supabaseAuth);
});
