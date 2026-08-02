import type { StateCreator } from 'zustand';
import type { PresenceSlice } from './presence.slice.js';
import type { ThreadSlice } from './thread.slice.js';
import type { VoiceSlice } from './voice.slice.js';

export type VoiceStatus = 'idle' | 'connecting' | 'active' | 'ended' | 'error';
export type PanelMode = 'text' | 'voice';

// Epic 13-s2 — the valet presence machine. `atRest` = the quiet ambient dot, no
// open sheet. `summoned` = the focused temporary sheet is open (runs a turn, then
// recedes). `whisper` = the single dismissible nudge line (13-s3).
export type PresenceState = 'atRest' | 'whisper' | 'summoned';

// Epic 13-s10 — the plan-edit scope. Frontend-only routing state (NOT part of
// the LumiContextSignal wire shape POSTed to /v1/lumi/turns): when it is set,
// the sheet routes a typed utterance to POST /v1/plans/:planId/edit instead of
// the general turn endpoint, and renders the tapped day's context. `day` is the
// short weekday the plan-intent classifier uses; dayLabel + dishes are the
// display context the summoning surface (a PlanTile, or the week-level
// TalkToLumi button) captured. Week-level scope omits day/dayLabel/dishes.
// 'sat' included: WeekdaySchema admits saturday plan days and the day-detail
// sheet (14-s4) can summon a swap for one. The Brief's day-chip picker still
// offers mon–fri only (ALL_DAYS in PlanEditPanel).
export type PlanEditDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export interface PlanEditScope {
  planId: string;
  weekOf: string;
  day?: PlanEditDay;
  dayLabel?: string;
  dishes?: string[];
  // Rosters the zero-LLM clarify chips draw from (captured by the summoning
  // surface so the sheet stays self-contained — no extra queries). `days` is the
  // week's non-paused days; `children` is the plan's child roster (id + name).
  days?: PlanEditDay[];
  children?: { id: string; name: string }[];
  // 13-s10 (AC9) — a proactive offer that opens the sheet directly on a
  // confirm-then-fire gate (e.g. the Friday next-week nudge → compose_next). No
  // classifier call; nothing fires without the explicit confirm tap.
  offer?: 'compose_next';
}

// Story 14-s6 — the store is composed from three slices (presence / thread /
// voice) but stays ONE flat store: `set` writes any key from any slice, so the
// cross-slice atomics (setContext, endTalkSession, dismissNudge) remain single
// set() calls exactly as before. The split is organizational, not a state
// boundary — consumers, selectors and bare setState() calls are unaffected.
export type LumiStore = PresenceSlice & ThreadSlice & VoiceSlice & { reset: () => void };

export type LumiSliceCreator<T> = StateCreator<LumiStore, [], [], T>;
