import fp from 'fastify-plugin';
import { createClient } from '@supabase/supabase-js';

export const supabasePlugin = fp(async (fastify) => {
  const client = createClient(fastify.env.SUPABASE_URL, fastify.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  fastify.decorate('supabase', client);
});
