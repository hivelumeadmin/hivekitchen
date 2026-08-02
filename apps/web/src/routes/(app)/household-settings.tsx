import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HouseholdMembersResponseSchema,
  HouseholdGeolocationConsentSchema,
  AutoComposeStateSchema,
} from '@hivekitchen/contracts';
import type {
  HouseholdMember,
  CreateInviteResponse,
} from '@hivekitchen/types';
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

  // Slice 5-S14 — household-level geolocation opt-in. Consent-only: enabling
  // requests browser permission but never sends coordinates to the server.
  const didLoadGeolocation = useRef(false);
  const [geolocationEnabled, setGeolocationEnabled] = useState(false);
  const [geolocationLoading, setGeolocationLoading] = useState(false);
  const [geolocationError, setGeolocationError] = useState<string | null>(null);

  // Story 3-S35 — weekly auto-compose enrollment. Surfaced only for the primary
  // parent and only after the first plan exists (has_plan). Toggle is on/off.
  const didLoadAutoCompose = useRef(false);
  const [autoComposeEnabled, setAutoComposeEnabled] = useState(false);
  const [autoComposeHasPlan, setAutoComposeHasPlan] = useState(false);
  const [autoComposeLoading, setAutoComposeLoading] = useState(false);
  const [autoComposeError, setAutoComposeError] = useState<string | null>(null);

  const clearSession = useAuthStore((s) => s.clearSession);
  const [devResetAllState, setDevResetAllState] = useState<'idle' | 'running' | 'error'>('idle');
  const [devResetPlansState, setDevResetPlansState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');

  async function handleDevResetAll() {
    if (devResetAllState === 'running') return;
    setDevResetAllState('running');
    try {
      await hkFetch('/v1/dev/reset-all', { method: 'DELETE' });
      clearSession();
      navigate('/auth/login', { replace: true });
    } catch {
      setDevResetAllState('error');
      setTimeout(() => setDevResetAllState('idle'), 2000);
    }
  }

  async function handleDevResetPlans() {
    if (devResetPlansState === 'running') return;
    setDevResetPlansState('running');
    try {
      await hkFetch('/v1/dev/reset-plans', { method: 'DELETE' });
      setDevResetPlansState('done');
      setTimeout(() => window.location.reload(), 600);
    } catch {
      setDevResetPlansState('error');
      setTimeout(() => setDevResetPlansState('idle'), 2000);
    }
  }

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
    return () => {
      controller.abort();
      didLoad.current = false;
    };
  }, [accessToken, householdId, navigate]);

  // Load current geolocation consent on mount (caregivers only — guest_author
  // never sees the section). Fail-open: a load failure leaves the toggle off.
  useEffect(() => {
    if (!accessToken || householdId === null || role === 'guest_author') return;
    if (didLoadGeolocation.current) return;
    didLoadGeolocation.current = true;
    void (async () => {
      try {
        const raw = await hkFetch<unknown>(
          `/v1/households/${householdId}/geolocation-consent`,
          { method: 'GET' },
        );
        const consent = HouseholdGeolocationConsentSchema.parse(raw);
        setGeolocationEnabled(consent.geolocation_enabled);
      } catch {
        // fail-open: default to false renders the toggle in a safe disabled state
      }
    })();
  }, [accessToken, householdId, role]);

  // Load current auto-compose state on mount (primary_parent only — the toggle
  // is primary-parent-gated). Fail-open: a load failure leaves the section
  // hidden (has_plan stays false).
  useEffect(() => {
    if (!accessToken || householdId === null || role !== 'primary_parent') return;
    if (didLoadAutoCompose.current) return;
    didLoadAutoCompose.current = true;
    void (async () => {
      try {
        const raw = await hkFetch<unknown>(`/v1/households/${householdId}/auto-compose`, {
          method: 'GET',
        });
        const state = AutoComposeStateSchema.parse(raw);
        setAutoComposeEnabled(state.auto_compose_enabled);
        setAutoComposeHasPlan(state.has_plan);
      } catch {
        // fail-open: leave the section hidden
      }
    })();
  }, [accessToken, householdId, role]);

  async function handleAutoComposeToggle(checked: boolean) {
    if (householdId === null) return;
    const previous = autoComposeEnabled;
    setAutoComposeError(null);
    setAutoComposeEnabled(checked);
    setAutoComposeLoading(true);
    try {
      const raw = await hkFetch<unknown>(`/v1/households/${householdId}/auto-compose`, {
        method: 'PATCH',
        body: { auto_compose_enabled: checked },
      });
      const state = AutoComposeStateSchema.parse(raw);
      setAutoComposeEnabled(state.auto_compose_enabled);
      setAutoComposeHasPlan(state.has_plan);
    } catch {
      setAutoComposeEnabled(previous);
      setAutoComposeError('Could not update this setting. Please try again.');
    } finally {
      setAutoComposeLoading(false);
    }
  }

  async function handleGeolocationToggle(checked: boolean) {
    if (householdId === null) return;
    setGeolocationError(null);

    if (checked) {
      setGeolocationLoading(true);
      try {
        // Request browser permission BEFORE calling the API. The
        // GeolocationPosition is intentionally discarded — no coordinates are
        // ever sent to the server (NFR-PRIV-3).
        await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject);
        });
        const raw = await hkFetch<unknown>(
          `/v1/households/${householdId}/geolocation-consent`,
          {
            method: 'PATCH',
            body: { geolocation_enabled: true, geolocation_purpose: 'cultural_supplier_routing' },
          },
        );
        const consent = HouseholdGeolocationConsentSchema.parse(raw);
        setGeolocationEnabled(consent.geolocation_enabled);
      } catch (err) {
        // GeolocationPositionError.code === 1 is PERMISSION_DENIED. Checked by
        // shape (not instanceof) so denial is detectable under jsdom too.
        const isDenied =
          typeof err === 'object' && err !== null && (err as { code?: number }).code === 1;
        setGeolocationError(
          isDenied
            ? 'Location access was denied. Enable it in your browser settings.'
            : 'Could not update location setting. Please try again.',
        );
        setGeolocationEnabled(false);
      } finally {
        setGeolocationLoading(false);
      }
    } else {
      // Opt-out: no browser permission needed. Optimistic UI with revert.
      const previous = geolocationEnabled;
      setGeolocationEnabled(false);
      setGeolocationLoading(true);
      try {
        const raw = await hkFetch<unknown>(`/v1/households/${householdId}/geolocation-consent`, {
          method: 'PATCH',
          body: { geolocation_enabled: false },
        });
        const consent = HouseholdGeolocationConsentSchema.parse(raw);
        setGeolocationEnabled(consent.geolocation_enabled);
      } catch {
        setGeolocationEnabled(previous);
        setGeolocationError('Could not update location setting. Please try again.');
      } finally {
        setGeolocationLoading(false);
      }
    }
  }

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
              <li key={member.user_id} className="border-b border-[color-mix(in_srgb,var(--border)_20%,transparent)] pb-4">
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

          {/* Geolocation opt-in — primary_parent and secondary_caregiver only */}
          {(role === 'primary_parent' || role === 'secondary_caregiver') && (
            <section className="mt-12 border-t border-border pt-8">
              <h2 className="font-serif text-xl text-fg">Location</h2>
              <label className="mt-4 flex items-start justify-between gap-4 py-1">
                <span>
                  <span className="block text-sm text-fg">Find cultural suppliers near me</span>
                  <span className="mt-1 block text-sm text-fg-muted leading-relaxed">
                    Lumi uses your location to suggest nearby cultural grocery stores and suppliers.
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Find cultural suppliers near me"
                  aria-checked={geolocationEnabled}
                  checked={geolocationEnabled}
                  disabled={geolocationLoading}
                  onChange={(e) => void handleGeolocationToggle(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0"
                />
              </label>
              {geolocationError && (
                <p role="alert" className="mt-2 text-sm text-safety-red">
                  {geolocationError}
                </p>
              )}
            </section>
          )}

          {/* Auto-compose enrollment — primary_parent only, after the first plan */}
          {role === 'primary_parent' && autoComposeHasPlan && (
            <section className="mt-12 border-t border-border pt-8">
              <h2 className="font-serif text-xl text-fg">Planning</h2>
              <label className="mt-4 flex items-start justify-between gap-4 py-1">
                <span>
                  <span className="block text-sm text-fg">
                    Auto-compose next week&apos;s plan — Friday evening
                  </span>
                  <span className="mt-1 block text-sm text-fg-muted leading-relaxed">
                    Lumi prepares next week&apos;s plan for you every Friday evening. Turn this off
                    to compose each week yourself.
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Auto-compose next week's plan"
                  aria-checked={autoComposeEnabled}
                  checked={autoComposeEnabled}
                  disabled={autoComposeLoading}
                  onChange={(e) => void handleAutoComposeToggle(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0"
                />
              </label>
              {autoComposeError && (
                <p role="alert" className="mt-2 text-sm text-safety-red">
                  {autoComposeError}
                </p>
              )}
            </section>
          )}
        </>
      )}

      {import.meta.env.DEV && (
        <section className="mt-12 border-t border-border pt-8">
          <h2 className="font-serif text-xl text-fg">Developer</h2>
          <p className="mt-1 font-sans text-sm text-fg-muted">
            Visible in dev mode only. These actions are irreversible.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleDevResetAll()}
              disabled={devResetAllState === 'running'}
              className="rounded border border-[color-mix(in_srgb,var(--safety-red)_40%,transparent)] px-4 py-2 text-sm text-safety-red hover:border-safety-red disabled:opacity-50 transition-colors"
            >
              {devResetAllState === 'running' && 'Resetting…'}
              {devResetAllState === 'error' && 'Error — try again'}
              {devResetAllState === 'idle' && 'Reset all + onboarding'}
            </button>
            <button
              type="button"
              onClick={() => void handleDevResetPlans()}
              disabled={devResetPlansState === 'running' || devResetPlansState === 'done'}
              className="rounded border border-border px-4 py-2 text-sm text-fg-muted hover:bg-surface-2 disabled:opacity-50 transition-colors"
            >
              {devResetPlansState === 'running' && 'Resetting…'}
              {devResetPlansState === 'done' && 'Done — reloading'}
              {devResetPlansState === 'error' && 'Error — try again'}
              {devResetPlansState === 'idle' && 'Reset weekly plans'}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
