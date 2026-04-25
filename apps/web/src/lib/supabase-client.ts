// PURPOSE-LIMITED CLIENT — initiates OAuth redirect flows only.
// Do NOT use this client for DB queries (architecture: API is the only door to the
// Data Layer). Do NOT call `auth.signInWithPassword` from here (that goes through
// /v1/auth/login server-side). The OAuth init is the deliberate exception because
// the redirect flow has to be browser-initiated; the OAuth code returned from the
// provider is exchanged server-side via /v1/auth/callback.

import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);
