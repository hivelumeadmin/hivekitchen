import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  OPENING_GREETING,
  M1_HINT_CHIPS,
  TextOnboardingTurnResponseSchema,
  TextOnboardingFinalizeResponseSchema,
  type ChipConfig,
} from '@hivekitchen/contracts';
import type { KitchenMap } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';

export type Turn = { id: string; role: 'lumi' | 'user'; content: string };

const GREETING_TURN_ID = 'greeting';

// Control keys drive the moment machine but are not content the parent "said" —
// they must never render as a chat echo bubble.
const CONTROL_CHIP_KEYS = new Set(['skip', 'override_fewer']);

export interface OnboardingTextProps {
  onFinalized?: () => void;
  initialTurns?: Array<{ id: string; role: 'lumi' | 'user'; content: string }>;
  initialHouseholdDisplayName?: string | null;
  initialMomentKey?: string | null;
  initialChipConfig?: ChipConfig | null;
}

// A resumed chip turn may arrive from GET /onboarding/state with the server's
// "[Chips selected: …]" wire prefix embedded in the content. The valet rebuild
// (13-s5 AC2) never shows that sentinel — strip the wrapper for display, keeping
// the readable selections and any trailing free text.
export function formatUserEcho(content: string): string {
  const bracket = /\[Chips selected:\s*([^\]]*)\]/.exec(content);
  if (bracket === null) return content.trim();
  const selections = bracket[1]!.trim();
  const rest = content.replace(/\[Chips selected:\s*[^\]]*\]/g, '').trim();
  if (rest.length === 0) return selections;
  return selections.length > 0 ? `${selections} — ${rest}` : rest;
}

/**
 * Onboarding conversation state + turn/finalize/resume orchestration.
 *
 * Consumes the shipped Epic 2.7 backend as a black box (POST
 * /v1/onboarding/text/turn → moment_key + chip_config + required-set), and the
 * authoritative KitchenMap projection (GET /households/:id/kitchen-map) as the
 * single source of truth for the hero. No client-side transcript heuristics
 * (13-s5 Scope Decision 2) — the 2.7 slot model owns household state.
 */
export function useOnboardingConversation({
  onFinalized,
  initialTurns,
  initialHouseholdDisplayName,
  initialMomentKey,
  initialChipConfig,
}: OnboardingTextProps) {
  const navigate = useNavigate();
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);

  const [turns, setTurns] = useState<Turn[]>(() => {
    const seed: Turn[] = [{ id: GREETING_TURN_ID, role: 'lumi', content: OPENING_GREETING }];
    if (initialTurns !== undefined) {
      for (const t of initialTurns) seed.push({ id: t.id, role: t.role, content: t.content });
    }
    return seed;
  });
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  // On a fresh start M1 hint chips ship with the greeting; on resume the parent
  // is mid-flow, so start from the resumed chip_config (or null).
  const [chipConfig, setChipConfig] = useState<ChipConfig | null>(
    initialTurns !== undefined ? (initialChipConfig ?? null) : M1_HINT_CHIPS,
  );
  const [chipSelections, setChipSelections] = useState<string[]>([]);
  const [currentMomentKey, setCurrentMomentKey] = useState<string | null>(
    initialTurns !== undefined ? (initialMomentKey ?? null) : null,
  );
  const [requiredSetComplete, setRequiredSetComplete] = useState<boolean | null>(null);
  const [missingRequiredSet, setMissingRequiredSet] = useState<string[]>([]);
  const [coldStartMode, setColdStartMode] = useState(false);
  const [coldStartDishCount, setColdStartDishCount] = useState(0);
  const [householdDisplayName, setHouseholdDisplayName] = useState<string | null>(
    initialHouseholdDisplayName ?? null,
  );
  // Authoritative hero source — refetched after each turn. mapPending drives the
  // thin placeholder while a refetch is in flight (13-s5 Q2 decision).
  const [kitchenMap, setKitchenMap] = useState<KitchenMap | null>(null);
  const [mapPending, setMapPending] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  // Synchronous re-entrancy guard — `pending` is async state, so two calls in
  // the same tick (e.g. Enter + a control-chip click) can both pass its check.
  const submittingRef = useRef(false);
  // Monotonic sequence for the post-turn map fetch so an out-of-order response
  // can't overwrite the hero with a staler snapshot.
  const mapFetchSeqRef = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Clear stale required-set / gap callouts when navigating away from summary.
  useEffect(() => {
    if (currentMomentKey !== null && currentMomentKey !== 'summary') {
      setMissingRequiredSet([]);
      setRequiredSetComplete(null);
    }
  }, [currentMomentKey]);

  const fetchKitchenMap = useCallback(async () => {
    if (householdId === null) return;
    const seq = (mapFetchSeqRef.current += 1);
    setMapPending(true);
    try {
      const map = await hkFetch<KitchenMap>(`/v1/households/${householdId}/kitchen-map`, {
        method: 'GET',
      });
      if (seq === mapFetchSeqRef.current) setKitchenMap(map);
    } catch {
      // best-effort — the hero keeps its last authoritative snapshot
    } finally {
      if (seq === mapFetchSeqRef.current) setMapPending(false);
    }
  }, [householdId]);

  // On resume, pre-populate the hero from the DB so it shows authoritative data
  // immediately rather than waiting for the parent's first new turn.
  const initialTurnCount = initialTurns?.length ?? 0;
  useEffect(() => {
    if (initialTurnCount === 0) return;
    void fetchKitchenMap();
  }, [fetchKitchenMap, initialTurnCount]);

  // Chip tap. M2 enforces "No known allergens" mutual exclusivity (safety wall);
  // action mode is single-select; choice mode is multi-select.
  const toggleChip = useCallback(
    (optKey: string) => {
      if (chipConfig?.mode === 'action') {
        setChipSelections([optKey]);
        return;
      }
      if (currentMomentKey === 'm2_safe') {
        setChipSelections((prev) => {
          if (optKey === 'none') return prev.includes('none') ? [] : ['none'];
          const withoutNone = prev.filter((k) => k !== 'none');
          return withoutNone.includes(optKey)
            ? withoutNone.filter((k) => k !== optKey)
            : [...withoutNone, optKey];
        });
        return;
      }
      setChipSelections((prev) =>
        prev.includes(optKey) ? prev.filter((k) => k !== optKey) : [...prev, optKey],
      );
    },
    [chipConfig, currentMomentKey],
  );

  const submitTurn = useCallback(
    async (chipSelectionsSnapshot: string[], draftSnapshot: string) => {
      const hasChips = chipSelectionsSnapshot.length > 0;
      if (draftSnapshot.length === 0 && !hasChips) return;
      if (pending || submittingRef.current) return;
      submittingRef.current = true;

      setError(null);
      setPending(true);

      // Clean optimistic echo — readable chip labels, never the wire sentinel and
      // never a control key (skip / override_fewer are actions, not messages).
      const visibleKeys = chipSelectionsSnapshot.filter((k) => !CONTROL_CHIP_KEYS.has(k));
      const chipLabels = visibleKeys.map(
        (k) => chipConfig?.options?.find((o) => o.key === k)?.label ?? k,
      );
      const echo =
        chipLabels.length > 0
          ? draftSnapshot.length > 0
            ? `${chipLabels.join(', ')} — ${draftSnapshot}`
            : chipLabels.join(', ')
          : draftSnapshot;
      const hasEcho = echo.length > 0;
      const optimisticId = `local-${Date.now()}`;
      if (hasEcho) {
        setTurns((prev) => [...prev, { id: optimisticId, role: 'user', content: echo }]);
      }

      setDraft('');
      setChipSelections([]);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const body: { message: string } | { chip_selections: string[]; text?: string } = hasChips
        ? draftSnapshot.length > 0
          ? { chip_selections: chipSelectionsSnapshot, text: draftSnapshot }
          : { chip_selections: chipSelectionsSnapshot }
        : { message: draftSnapshot };

      try {
        const raw = await hkFetch<unknown>('/v1/onboarding/text/turn', {
          method: 'POST',
          body,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const parsed = TextOnboardingTurnResponseSchema.parse(raw);
        setTurns((prev) => [
          ...(hasEcho
            ? prev.map((t) => (t.id === optimisticId ? { ...t, id: parsed.turn_id } : t))
            : prev),
          { id: parsed.lumi_turn_id, role: 'lumi', content: parsed.lumi_response },
        ]);
        setIsComplete(parsed.is_complete);

        // Cold-start M5 gate: chip_config is null, so each free-text dish turn
        // counts as one. Chip taps (catalog seeded late) and the override tap
        // never count as dishes.
        if (currentMomentKey === 'm5_starting_line') {
          const overrideTapped = chipSelectionsSnapshot.includes('override_fewer');
          const addedCount = chipSelectionsSnapshot.filter(
            (k) => !CONTROL_CHIP_KEYS.has(k),
          ).length;
          const advancedOut =
            parsed.moment_key !== null &&
            parsed.moment_key !== undefined &&
            parsed.moment_key !== 'm5_starting_line';
          if (coldStartMode && !advancedOut && addedCount === 0 && !overrideTapped) {
            setColdStartDishCount((prev) => prev + 1);
          }
        }

        setChipConfig(parsed.chip_config ?? null);
        setCurrentMomentKey(parsed.moment_key ?? null);
        if (parsed.cold_start_mode === true) setColdStartMode(true);
        if (parsed.required_set_complete !== null && parsed.required_set_complete !== undefined) {
          setRequiredSetComplete(parsed.required_set_complete);
        }
        if (parsed.missing_required_set !== undefined) {
          setMissingRequiredSet(parsed.missing_required_set);
        }
        if (parsed.household_display_name !== null && parsed.household_display_name !== undefined) {
          setHouseholdDisplayName(parsed.household_display_name);
        }
        // Agent tool calls have written to the DB by now — refresh the hero.
        void fetchKitchenMap();
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const isUpstream = err instanceof HkApiError && err.status === 502;
        const message = isUpstream
          ? "I'm having a little trouble — try sending that again in a moment."
          : err instanceof HkApiError && err.status === 409
            ? 'Onboarding is already complete for this household.'
            : 'Something went wrong. Try again?';
        setError(message);
        // Only the 502 path leaves the turn persisted server-side. Every other
        // failure rolls back the optimistic render and restores draft + chips.
        if (!isUpstream) {
          if (hasEcho) setTurns((prev) => prev.filter((t) => t.id !== optimisticId));
          setDraft(draftSnapshot);
          setChipSelections(chipSelectionsSnapshot);
        }
      } finally {
        submittingRef.current = false;
        if (!controller.signal.aborted) setPending(false);
      }
    },
    [pending, currentMomentKey, chipConfig, coldStartMode, fetchKitchenMap],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await submitTurn(chipSelections, draft.trim());
    },
    [draft, chipSelections, submitTurn],
  );

  const handleFinalize = useCallback(async () => {
    if (finalizing) return;
    setError(null);
    setFinalizing(true);
    try {
      const raw = await hkFetch<unknown>('/v1/onboarding/text/finalize', { method: 'POST' });
      TextOnboardingFinalizeResponseSchema.parse(raw);
      if (onFinalized !== undefined) {
        onFinalized();
      } else {
        void navigate('/app');
      }
    } catch (err) {
      const message =
        err instanceof HkApiError && err.status === 409
          ? 'Onboarding is not quite ready to finish — keep talking with Lumi for a moment.'
          : "I couldn't finish onboarding right now. Try again?";
      setError(message);
      setFinalizing(false);
    }
  }, [finalizing, navigate, onFinalized]);

  return {
    turns,
    draft,
    setDraft,
    pending,
    isComplete,
    error,
    finalizing,
    chipConfig,
    chipSelections,
    toggleChip,
    currentMomentKey,
    setCurrentMomentKey,
    requiredSetComplete,
    missingRequiredSet,
    coldStartMode,
    coldStartDishCount,
    householdDisplayName,
    kitchenMap,
    mapPending,
    isResume: initialTurns !== undefined && initialTurns.length > 0,
    submitTurn,
    handleSubmit,
    handleFinalize,
    fetchKitchenMap,
  };
}
