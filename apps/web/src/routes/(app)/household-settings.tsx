import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HouseholdMembersResponseSchema } from '@hivekitchen/contracts';
import type { HouseholdMember, CreateInviteResponse } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';

type LoadState = 'loading' | 'ready' | 'error';

const ERROR_COPY = "Lumi couldn't load your household right now. Try refreshing.";

function roleLabel(role: HouseholdMember['role']): string {
  return role === 'primary_parent' ? 'Primary Parent' : 'Caregiver';
}

export default function HouseholdSettingsRoute() {
  useLumiContext({ surface: 'general' });

  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const role = useAuthStore((s) => s.user?.role ?? null);
  const didLoad = useRef(false);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [householdDisplayName, setHouseholdDisplayName] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      navigate('/auth/login?next=/app/household/settings', { replace: true });
      return;
    }
    if (householdId === null || didLoad.current) return;
    didLoad.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const raw = await hkFetch<unknown>(`/v1/households/${householdId}/members`, {
          method: 'GET',
          signal: controller.signal,
        });
        const parsed = HouseholdMembersResponseSchema.parse(raw);
        setMembers(parsed.members);
        setHouseholdDisplayName(parsed.household_display_name);
        setLoadState('ready');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (err instanceof HkApiError && err.status === 401) {
          navigate('/auth/login?next=/app/household/settings', { replace: true });
          return;
        }
        didLoad.current = false;
        setLoadState('error');
      }
    })();
    return () => controller.abort();
  }, [accessToken, householdId, navigate]);

  async function handleGenerateInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (householdId === null) return;
    setInviteError(null);
    setCopied(false);
    setInviting(true);
    try {
      const result = await hkFetch<CreateInviteResponse>(
        `/v1/households/${householdId}/invites`,
        {
          method: 'POST',
          // hkFetch JSON-stringifies the body — pass the raw object (project trap).
          body: { role: 'secondary_caregiver', email: email.trim() || undefined },
        },
      );
      setInviteUrl(`${window.location.origin}${result.invite_url}`);
    } catch {
      setInviteError('Could not create an invite link. Please try again.');
    } finally {
      setInviting(false);
    }
  }

  async function handleCopy() {
    if (inviteUrl === null) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-grow px-4 py-16 sm:px-6 md:py-24">
      <h1 className="font-serif text-3xl text-fg">{householdDisplayName ?? 'Household'}</h1>
      <p className="mt-2 font-sans text-base text-fg-muted leading-relaxed">
        Everyone who helps plan lunches for your household.
      </p>

      {loadState === 'loading' ? (
        <div role="status" aria-label="Loading your household" className="mt-8 space-y-3">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-10 rounded bg-surface animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : loadState === 'error' ? (
        <p role="alert" className="mt-8 font-sans text-base text-fg-muted">
          {ERROR_COPY}
        </p>
      ) : (
        <>
          <ul className="mt-8 space-y-4">
            {members.map((member) => (
              <li key={member.user_id} className="border-b border-border/20 pb-4">
                <p className="font-sans text-sm text-fg">{member.display_name ?? 'Unknown'}</p>
                <p className="mt-1 font-sans text-xs text-fg-muted">{roleLabel(member.role)}</p>
              </li>
            ))}
          </ul>

          {role === 'primary_parent' && (
            <section className="mt-12 border-t border-border pt-8">
              <h2 className="font-serif text-xl text-fg">Invite partner</h2>
              <p className="mt-2 font-sans text-sm text-fg-muted leading-relaxed">
                Generate a link your partner can open to join this household as a caregiver.
              </p>

              {!inviteOpen ? (
                <button
                  type="button"
                  onClick={() => setInviteOpen(true)}
                  className="mt-4 rounded border border-border px-4 py-2 text-sm"
                >
                  Invite partner
                </button>
              ) : (
                <form onSubmit={handleGenerateInvite} className="mt-4 space-y-4" noValidate>
                  <div className="space-y-1">
                    <label htmlFor="partner-email" className="block text-sm">
                      Partner&apos;s email (optional)
                    </label>
                    <input
                      id="partner-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      maxLength={254}
                      className="w-full rounded border border-border px-3 py-2"
                    />
                  </div>
                  {inviteError && (
                    <p role="alert" className="text-sm text-safety-red">
                      {inviteError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={inviting}
                    className="rounded bg-amber-warm px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-amber motion-reduce:transition-none disabled:opacity-50"
                  >
                    {inviting ? 'Generating…' : 'Generate invite link'}
                  </button>
                </form>
              )}

              {inviteUrl !== null && (
                <div className="mt-6 flex items-center gap-3 rounded border border-border bg-surface px-4 py-3">
                  <a href={inviteUrl} className="flex-1 truncate font-sans text-sm text-fg underline">
                    {inviteUrl}
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="shrink-0 rounded border border-border px-3 py-1 text-xs"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
