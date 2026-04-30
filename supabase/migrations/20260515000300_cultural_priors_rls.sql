-- Story 2.11: enable RLS on cultural_priors.
-- All reads and writes go through the API service-role client, which bypasses
-- RLS. Enabling RLS here establishes the policy baseline so that anon/authed
-- Supabase clients (e.g., direct SDK calls) cannot read or mutate priors without
-- an explicit policy grant. No policies are added in this story; the surface is
-- API-only for now.
ALTER TABLE cultural_priors ENABLE ROW LEVEL SECURITY;
