import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  OPENING_GREETING,
  TextOnboardingTurnResponseSchema,
  TextOnboardingFinalizeResponseSchema,
  type ChipConfig,
} from '@hivekitchen/contracts';
import type { BagCompositionPattern } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { ChoiceChip } from './components/ChoiceChip.js';
import { HintChip } from './components/HintChip.js';
import { SkipChip } from './components/SkipChip.js';

type Turn = { id: string; role: 'lumi' | 'user'; content: string };
const GREETING_TURN_ID = 'greeting';

// Slice 2.5-s6 — M2 capture state for the KitchenProfilePanel safety card.
// 'none' is the bootstrap state (M2 not yet reached); 'capturing' is set the
// moment the agent advances into m2_safe; 'all-clear' and 'declared' are the
// two terminal shapes after the parent submits a chip-bearing turn.
type M2CaptureState =
  | { state: 'none' }
  | { state: 'capturing' }
  | { state: 'all-clear' }
  | { state: 'declared'; chips: Array<{ key: string; label: string }> };

// Slice 2.5-s7 — M3 taste capture state. M3 is OPTIONAL; 'skipped' is the
// terminal state when the parent taps the Skip chip. 'partial' is set when
// the agent advances past M3 (we don't track per-tool capture in this slice;
// the canonical surface is 2.5-s11's Kitchen Profile live-data card).
type M3TasteCaptureState =
  | { state: 'none' }
  | { state: 'capturing' }
  | { state: 'skipped' }
  | { state: 'partial' };

// Slice 2.5-s8 — M4 bag capture state. M4 is a required-response gate (no
// skip variant). The captured state carries the parent's selection mode so
// future surfaces can distinguish a single chip-tap ("same for both kids")
// from prose-driven per-child variation. Full structured display reads from
// KitchenMapSchema in 2.5-s11; this card keeps a lean confirmation.
type M4BagCaptureState =
  | { state: 'none' }
  | { state: 'capturing' }
  | { state: 'captured'; mode: 'household'; pattern: BagCompositionPattern }
  | { state: 'captured'; mode: 'per-child'; children: Array<{ name: string; pattern: BagCompositionPattern }> };

// Slice 2.5-s5 — Moment header config. The text path knows all 7 moments the
// agent can emit; pre_start / finalized produce number=0 so the header falls
// back to the legacy "Step N of ~8" subtitle on the very first mount.
const MOMENT_CONFIG: Record<string, { number: number; name: string }> = {
  pre_start: { number: 0, name: '' },
  m1_table: { number: 1, name: "Who's at the table" },
  m2_safe: { number: 2, name: 'What I need to keep safe' },
  m3_taste: { number: 3, name: 'How your kitchen tastes' },
  m4_bag: { number: 4, name: 'What goes in the bag' },
  m5_starting_line: { number: 5, name: 'A starting line for Lumi' },
  summary: { number: 6, name: 'Summary' },
  finalized: { number: 0, name: '' },
};

export interface OnboardingTextProps {
  onFinalized?: () => void;
  initialTurns?: Array<{ id: string; role: 'lumi' | 'user'; content: string }>;
}

// ─── SVG icons ───────────────────────────────────────────────────────────────

function IcoWaveform({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.25v7.5m3-10.5v13.5M9 6.75v10.5m3-13.5v16.5m3-13.5v10.5m3-7.5v4.5" />
    </svg>
  );
}
function IcoHistory({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function IcoSend({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
    </svg>
  );
}
function IcoUsers({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}
function IcoShield({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}
function IcoHeart({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
    </svg>
  );
}
function IcoClock({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function IcoGlobe({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}
function IcoHome({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12l8.954-8.955a1.5 1.5 0 012.122 0L22.28 12M4.5 9.75v10.125a1.125 1.125 0 001.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125a1.125 1.125 0 001.125-1.125V9.75"
      />
    </svg>
  );
}
function IcoLunchBag({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  );
}

// ─── Profile panel ────────────────────────────────────────────────────────────

type TopicKey = 'family' | 'allergens' | 'preferences' | 'schedule' | 'cultural';

const TOPIC_CONFIG: Array<{
  key: TopicKey;
  label: string;
  waitingLabel: string;
  Icon: ({ cls }: { cls: string }) => React.ReactElement;
}> = [
  { key: 'family', label: 'Family', waitingLabel: 'Family members', Icon: IcoUsers },
  { key: 'allergens', label: 'Allergens & Safety', waitingLabel: 'Allergens & Safety', Icon: IcoShield },
  { key: 'preferences', label: 'Food Preferences', waitingLabel: 'Food Preferences', Icon: IcoHeart },
  { key: 'schedule', label: 'School Schedule', waitingLabel: 'School Schedule', Icon: IcoClock },
  { key: 'cultural', label: 'Food Culture', waitingLabel: 'Cultural Cuisine', Icon: IcoGlobe },
];

function detectTopics(turns: Turn[]): Record<TopicKey, boolean> {
  const userTurns = turns.filter((t) => t.role === 'user');
  const allText = turns.map((t) => t.content).join(' ').toLowerCase();

  return {
    family: userTurns.length >= 1,
    allergens:
      /\b(allerg|avoid|intoleran|nut|peanut|gluten|dairy|egg|shellfish|soy|sesame)\b/.test(allText) ||
      userTurns.length >= 3,
    preferences:
      userTurns.length >= 4 ||
      /\b(love|like|hate|dislike|favour|prefer|enjoy|won.?t eat|doesn.?t eat)\b/.test(allText),
    schedule:
      userTurns.length >= 6 ||
      /\b(monday|tuesday|wednesday|thursday|friday|school day|pickup|drop.?off)\b/.test(allText),
    cultural:
      /\b(kosher|halal|vegan|vegetarian|indian|asian|italian|mexican|chinese|japanese|heritage|tradition|cultural|religious)\b/.test(
        allText,
      ) || userTurns.length >= 7,
  };
}

// ─── Conversation data extraction ────────────────────────────────────────────

interface ChildInfo { name: string; age?: number }

// Common words that match name-like patterns but aren't names
const NAME_STOP_WORDS = new Set([
  // pronouns / determiners
  'she', 'he', 'they', 'it', 'we', 'my', 'your', 'our', 'the', 'that', 'this',
  'these', 'those', 'them', 'their', 'his', 'her',
  // conjunctions / prepositions
  'and', 'but', 'or', 'so', 'for', 'with', 'from', 'into', 'onto', 'about',
  'after', 'before', 'during', 'over', 'under', 'through', 'between',
  // verbs
  'is', 'are', 'was', 'has', 'had', 'have', 'been', 'will', 'can', 'did',
  // numbers as words
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  // domain stop words
  'lumi', 'kitchen', 'school', 'food', 'lunch', 'dinner', 'monday', 'tuesday',
  'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  // common non-name words that could appear after "added"/"noted"
  'that', 'some', 'any', 'all', 'both', 'more', 'most', 'other', 'such',
  'information', 'details', 'notes', 'profile', 'household', 'family',
  'allergy', 'allergen', 'preference', 'diet', 'cultural',
]);

function extractChildren(turns: Turn[]): ChildInfo[] {
  // Search ALL turns — Lumi echoes names back, making them more reliably detectable
  const allText = turns.map((t) => t.content).join('\n');
  const found: ChildInfo[] = [];
  const seen = new Set<string>();

  const isValidAge = (n: number) => n >= 1 && n <= 18;

  const add = (rawName: string, age?: number) => {
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
    if (
      name.length >= 2 &&
      !seen.has(name.toLowerCase()) &&
      !NAME_STOP_WORDS.has(name.toLowerCase()) &&
      /^[A-Za-z]+$/.test(name)
    ) {
      found.push({ name, age: age !== undefined && isValidAge(age) ? age : undefined });
      seen.add(name.toLowerCase());
    }
  };

  // "Maya (8)" or "maya(8)"
  for (const m of allText.matchAll(/\b([A-Za-z]{2,15})\s*\((\d{1,2})\)/g)) {
    add(m[1]!, Number(m[2]));
  }
  // "8-year-old Maya"
  for (const m of allText.matchAll(/\b(\d{1,2})[- ]year[- ]old\s+([A-Za-z]{2,15})/gi)) {
    add(m[2]!, Number(m[1]));
  }
  // "Maya is 8" / "Maya who is 8" / "Maya who's 8" / "Maya aged 8"
  for (const m of allText.matchAll(/\b([A-Za-z]{2,15}),?\s+(?:who\s+)?(?:is|was|aged|who's)\s+(\d{1,2})\b/gi)) {
    add(m[1]!, Number(m[2]));
  }
  // "Maya, 8" or "Maya - 8" or "Maya – 8" (name then age with separator)
  for (const m of allText.matchAll(/\b([A-Za-z]{2,15})\s*[,\-–]\s*(\d{1,2})\b/g)) {
    const age = Number(m[2]);
    if (isValidAge(age)) add(m[1]!, age);
  }
  // "8 yo Maya" / "8yo Maya"
  for (const m of allText.matchAll(/\b(\d{1,2})\s*yo\s+([A-Za-z]{2,15})/gi)) {
    add(m[2]!, Number(m[1]));
  }
  // "my daughter/son/child Maya" or "daughter named Maya"
  for (const m of allText.matchAll(/\b(?:daughter|son|child|kid|girl|boy)\s+(?:named?\s+)?([A-Za-z]{2,15})\b/gi)) {
    add(m[1]!);
  }
  // "I have two kids, Maya and Tom" / "kids are Maya and Tom" — names after "and"/"," in child context
  for (const m of allText.matchAll(/\b(?:kids?|children|sons?|daughters?)\s+(?:are|is|named?|called)?\s*([A-Za-z]{2,15})(?:\s+and\s+([A-Za-z]{2,15}))?/gi)) {
    if (m[1]) add(m[1]!);
    if (m[2]) add(m[2]!);
  }
  // Lumi confirmation echoes: "added Maya to your profile" / "noted Maya and Tom"
  for (const m of allText.matchAll(/\b(?:added|noted|recorded|have)\s+([A-Za-z]{2,15})(?:\s+and\s+([A-Za-z]{2,15}))?\b/gi)) {
    if (m[1] && !NAME_STOP_WORDS.has(m[1]!.toLowerCase())) add(m[1]!);
    if (m[2] && !NAME_STOP_WORDS.has(m[2]!.toLowerCase())) add(m[2]!);
  }

  return found;
}

// ─── Food preferences extraction ─────────────────────────────────────────────

const FOOD_WORDS = [
  'pasta', 'pizza', 'sandwich', 'rice', 'noodles', 'bread', 'salad', 'soup',
  'chicken', 'beef', 'lamb', 'pork', 'fish', 'seafood', 'eggs', 'cheese',
  'yogurt', 'fruit', 'berries', 'vegetables', 'spicy', 'sweets', 'chocolate',
  'wraps', 'tacos', 'sushi', 'curry', 'stir.?fry', 'stew',
];

function extractFoodPreferences(turns: Turn[]): { likes: string[]; dislikes: string[] } {
  const allText = turns.map((t) => t.content).join('\n');
  const likes: string[] = [];
  const dislikes: string[] = [];
  const seenL = new Set<string>();
  const seenD = new Set<string>();

  const addIfFood = (phrase: string, bucket: string[], seen: Set<string>) => {
    for (const word of FOOD_WORDS) {
      if (new RegExp(`\\b${word}s?\\b`, 'i').test(phrase)) {
        const label = word.replace(/\\?\.?\?/g, '').replace(/[^a-z]/g, '');
        const display = label.charAt(0).toUpperCase() + label.slice(1);
        if (!seenL.has(display) && !seenD.has(display) && !seen.has(display)) {
          bucket.push(display);
          seen.add(display);
        }
      }
    }
  };

  const likeRe = /(?:love[sd]?|like[sd]?|enjoy[sd]?|favourite[s]?|prefer[sd]?|obsessed\s+with|big\s+fan\s+of)\s+([^.,!?\n]{3,50})/gi;
  for (const m of allText.matchAll(likeRe)) addIfFood(m[1]!, likes, seenL);

  const dislikeRe = /(?:hate[sd]?|dislike[sd]?|won'?t\s+eat|doesn'?t\s+(?:like|eat)|not\s+(?:a\s+fan|keen|into)|avoid[sd]?)\s+([^.,!?\n]{3,50})/gi;
  for (const m of allText.matchAll(dislikeRe)) addIfFood(m[1]!, dislikes, seenD);

  return { likes, dislikes };
}

// ─── Schedule extraction ──────────────────────────────────────────────────────

function extractSchedule(turns: Turn[]): string[] {
  const allText = turns.map((t) => t.content).join('\n');
  const items: string[] = [];

  if (/\b5\s*days?\b|\bmon(?:day)?\s*(?:to|through|[-–])\s*fri/i.test(allText)) items.push('Mon – Fri');
  else if (/\b4\s*days?\b/i.test(allText)) items.push('4 days/week');
  else if (/\b3\s*days?\b/i.test(allText)) items.push('3 days/week');

  if (/\b(packed\s+lunch|brings?\s+lunch|home\s+lunch)\b/i.test(allText)) items.push('Packed lunch');
  if (/\b(school\s+(lunch|canteen|cafeteria)|buys?\s+lunch|hot\s+lunch)\b/i.test(allText)) items.push('School canteen');

  // Specific days (only if fewer than 5 — 5 days covered by "Mon–Fri")
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const mentioned = DAY_NAMES.filter((d) => new RegExp(`\\b${d}\\b`, 'i').test(allText));
  if (mentioned.length > 0 && mentioned.length < 5) {
    for (const d of mentioned) items.push(d);
  }

  return items;
}

// ─── Cultural / dietary extraction ───────────────────────────────────────────

const CULTURAL_PATTERNS: Array<[RegExp, string]> = [
  [/\bvegetarian\b/i, 'Vegetarian'],
  [/\bvegan\b/i, 'Vegan'],
  [/\bpescatarian\b/i, 'Pescatarian'],
  [/\bkosher\b/i, 'Kosher'],
  [/\bhalal\b/i, 'Halal'],
  [/\bgluten[- ]free\b/i, 'Gluten-free'],
  [/\bdairy[- ]free\b/i, 'Dairy-free'],
  [/\bplant[- ]based\b/i, 'Plant-based'],
  [/\bindian\b/i, 'Indian'],
  [/\bjapanese\b/i, 'Japanese'],
  [/\bchinese\b/i, 'Chinese'],
  [/\bitalian\b/i, 'Italian'],
  [/\bmexican\b/i, 'Mexican'],
  [/\bmediterranean\b/i, 'Mediterranean'],
  [/\bmiddle\s+eastern\b/i, 'Middle Eastern'],
  [/\basian\b/i, 'Asian'],
];

function extractCulturalPrefs(turns: Turn[]): string[] {
  const allText = turns.map((t) => t.content).join('\n');
  const items: string[] = [];
  for (const [re, label] of CULTURAL_PATTERNS) {
    if (re.test(allText)) items.push(label);
  }
  return items;
}

// ─── Allergen extraction ──────────────────────────────────────────────────────

const ALLERGEN_PATTERNS: Array<[RegExp, string]> = [
  [/\bpeanuts?\b/i, 'Peanuts'],
  [/\btree\s*nuts?\b/i, 'Tree nuts'],
  [/\b(milk|dairy)\b/i, 'Dairy'],
  [/\beggs?\b/i, 'Eggs'],
  [/\b(wheat|gluten)\b/i, 'Gluten'],
  [/\bsoy(a|bean)?\b/i, 'Soy'],
  [/\bshellfish\b/i, 'Shellfish'],
  [/\bfish\b/i, 'Fish'],
  [/\bsesame\b/i, 'Sesame'],
  [/\bnuts?\b/i, 'Nuts'],
];

const ALL_CLEAR_RE = /\b(no\s+allerg|all\s+clear|none|no\s+known|not\s+allergic|no\s+food\s+allerg)\b/i;

interface AllergyProfile { childName: string; allergens: string[]; allClear: boolean }

function extractAllergyProfiles(turns: Turn[], children: ChildInfo[]): AllergyProfile[] {
  const allText = turns.map((t) => t.content).join('\n');

  const contextFor = (name: string): string => {
    const chunks: string[] = [];
    const re = new RegExp(`\\b${name}\\b`, 'gi');
    for (const m of allText.matchAll(re)) {
      const s = Math.max(0, m.index! - 150);
      const e = Math.min(allText.length, m.index! + 300);
      chunks.push(allText.slice(s, e));
    }
    return chunks.join(' ');
  };

  const pickAllergens = (text: string): string[] => {
    const out: string[] = [];
    for (const [re, label] of ALLERGEN_PATTERNS) {
      if (re.test(text) && !out.includes(label)) out.push(label);
    }
    return out;
  };

  if (children.length > 0) {
    return children.map((child) => {
      const ctx = contextFor(child.name);
      const allClear = ALL_CLEAR_RE.test(ctx);
      return { childName: child.name, allergens: allClear ? [] : pickAllergens(ctx), allClear };
    });
  }

  // No named children — try general extraction
  const allClear = ALL_CLEAR_RE.test(allText);
  const allergens = allClear ? [] : pickAllergens(allText);
  if (allClear || allergens.length > 0) return [{ childName: '', allergens, allClear }];
  return [];
}

// ─── Household name extraction ────────────────────────────────────────────────

// Slice 2.5-s5 — pull a household label out of Lumi's echo of the parent's
// answer. Best-effort only; the canonical value lives on households.display_name
// once the kitchen map read endpoint goes live (2.5-s11). Until then the
// profile panel needs *something* to render so the "Your kitchen" card lights
// up alongside the conversation. Two heuristics in priority order:
//   1. quoted strings (Lumi often repeats the name in quotes)
//   2. "the X kitchen" / "the X family" patterns
function extractHouseholdName(turns: Turn[]): string | null {
  const allLumi = turns
    .filter((t) => t.role === 'lumi')
    .map((t) => t.content)
    .join('\n');
  const quoted = allLumi.match(/"([^"]{2,60})"/)?.[1];
  if (quoted !== undefined) return quoted;
  const phrase = allLumi.match(/the\s+([A-Z][a-z]+ (?:family|kitchen))/)?.[1];
  return phrase ?? null;
}

// ─── Profile panel ─────────────────────────────────────────────────────────────

function KitchenProfilePanel({
  turns,
  currentMomentKey,
  m2AllergenCapture,
  m3TasteCapture,
  m4BagCapture,
}: {
  turns: Turn[];
  currentMomentKey: string | null;
  m2AllergenCapture: M2CaptureState;
  m3TasteCapture: M3TasteCaptureState;
  m4BagCapture: M4BagCaptureState;
}) {
  const topics = detectTopics(turns);
  const children = extractChildren(turns);
  const allergyProfiles = extractAllergyProfiles(turns, children);
  const foodPrefs = extractFoodPreferences(turns);
  const schedule = extractSchedule(turns);
  const culturalPrefs = extractCulturalPrefs(turns);
  const householdName = extractHouseholdName(turns);
  const coveredCount = TOPIC_CONFIG.filter((t) => topics[t.key]).length;
  const questionsComplete = Math.round((coveredCount / TOPIC_CONFIG.length) * 8);

  // Slice 2.5-s5 — moment-based progress when the wire surfaced a moment_key;
  // otherwise fall back to the legacy topic-detection heuristic so resume-mode
  // (initialTurns with no turn fired yet) still shows something useful.
  const momentMeta = currentMomentKey ? MOMENT_CONFIG[currentMomentKey] : undefined;
  const completedMoments =
    momentMeta !== undefined && momentMeta.number > 0
      ? Math.min(momentMeta.number - 1, 5)
      : 0;
  const progressPct =
    momentMeta !== undefined && momentMeta.number > 0
      ? Math.round((completedMoments / 5) * 100)
      : Math.round((coveredCount / TOPIC_CONFIG.length) * 100);
  const footerLabel =
    momentMeta !== undefined && momentMeta.number > 0
      ? `Moment ${completedMoments} of 5 complete`
      : `${questionsComplete} of ~8 questions complete`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-7 pt-8 pb-5">
        <h2 className="font-serif text-[22px] font-normal leading-tight text-fg">Your Kitchen Profile</h2>
        <p className="mt-2 flex items-center gap-1.5 font-sans text-[11px] text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
          Building as we talk…
        </p>
      </div>

      {/* Topic cards */}
      <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-3">
        {/* Slice 2.5-s5 — Moment 1 primary capture: household name. Renders
            as an active card once we can detect a label from Lumi's echo;
            otherwise a "still listening" waiting card. */}
        {householdName !== null ? (
          <div
            key="kitchen"
            className="rounded-xl p-5"
            style={{ background: 'var(--surface-2, var(--surface))' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <IcoHome cls="h-4 w-4 shrink-0 text-amber-soft" />
              <h3 className="font-serif text-base text-fg">Your kitchen</h3>
            </div>
            <p className="font-sans text-base italic text-fg">{householdName}</p>
          </div>
        ) : (
          <div
            key="kitchen"
            className="rounded-xl p-4 flex items-center gap-3.5"
            style={{ background: 'var(--surface)' }}
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'color-mix(in srgb, var(--amber) 12%, transparent)' }}
            >
              <IcoHome cls="h-[15px] w-[15px] text-amber/50" />
            </div>
            <div>
              <p className="font-sans text-sm font-medium text-fg/55">Kitchen name</p>
              <p className="font-sans text-[11px] mt-0.5 text-fg-muted/40">Still listening…</p>
            </div>
          </div>
        )}

        {TOPIC_CONFIG.map(({ key, label, waitingLabel, Icon }) => {
          const isActive = topics[key];

          // Slice 2.5-s6 — M2 primary capture takes precedence over the
          // legacy regex-based allergen detection. Once the parent has reached
          // Moment 2 (state !== 'none') the safety card reflects their actual
          // chip selections instead of heuristics on the transcript.
          if (key === 'allergens' && m2AllergenCapture.state !== 'none') {
            return (
              <div
                key={key}
                data-testid="m2-safety-card"
                className="rounded-xl p-5"
                style={{ background: 'var(--surface-2, var(--surface))' }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <IcoShield cls="h-4 w-4 shrink-0 text-safety-cleared" />
                  <h3 className="font-serif text-base text-fg">Safety — allergens</h3>
                </div>
                {m2AllergenCapture.state === 'capturing' && (
                  <p className="font-sans text-xs italic text-fg-muted">Waiting on your response…</p>
                )}
                {m2AllergenCapture.state === 'all-clear' && (
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-safety-cleared-fill px-2.5 py-1 font-sans text-xs text-safety-cleared">
                      ✓ All clear
                    </span>
                    <span className="font-sans text-xs text-fg-muted">No known allergens</span>
                  </div>
                )}
                {m2AllergenCapture.state === 'declared' && (
                  <div className="flex flex-wrap gap-1.5">
                    {m2AllergenCapture.chips.map(({ key: chipKey, label: chipLabel }) => (
                      <span
                        key={chipKey}
                        className="flex items-center gap-1 rounded-md bg-safety-cleared-fill px-2.5 py-1 font-sans text-xs text-safety-cleared"
                      >
                        <IcoShield cls="h-3 w-3 shrink-0" />
                        {chipLabel}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          if (isActive && key === 'family') {
            return (
              <div key={key} className="rounded-xl p-5" style={{ background: 'var(--surface-2, var(--surface))' }}>
                <h3 className="font-serif text-base text-fg mb-3">Family</h3>
                {children.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {children.map((child) => (
                      <span
                        key={child.name}
                        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-sans text-xs font-medium"
                        style={{
                          background: 'color-mix(in srgb, var(--amber) 16%, var(--surface-2, var(--surface)))',
                          color: 'var(--amber-soft, var(--amber))',
                        }}
                      >
                        <IcoUsers cls="h-3 w-3 shrink-0" />
                        {child.name}{child.age !== undefined ? ` (${child.age})` : ''}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="font-sans text-xs text-fg-muted/70">Family details noted</p>
                )}
              </div>
            );
          }

          if (isActive && key === 'allergens') {
            return (
              <div key={key} className="rounded-xl p-5" style={{ background: 'var(--surface-2, var(--surface))' }}>
                <div className="flex items-center gap-2 mb-3">
                  <IcoShield cls="h-4 w-4 shrink-0 text-amber-soft" />
                  <h3 className="font-serif text-base text-fg">Allergens & Safety</h3>
                </div>
                {allergyProfiles.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {allergyProfiles.map((profile, i) => (
                      <div key={i}>
                        {profile.childName && (
                          <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-fg-muted/55">
                            {profile.childName}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {profile.allClear ? (
                            <span
                              className="rounded-md px-2.5 py-1 font-sans text-xs"
                              style={{
                                background: 'color-mix(in srgb, #16a34a 18%, var(--surface-2, var(--surface)))',
                                color: '#86efac',
                              }}
                            >
                              All clear ✓
                            </span>
                          ) : profile.allergens.length > 0 ? (
                            profile.allergens.map((a) => (
                              <span
                                key={a}
                                className="rounded-md px-2.5 py-1 font-sans text-xs"
                                style={{
                                  background: 'color-mix(in srgb, #dc2626 18%, var(--surface-2, var(--surface)))',
                                  color: '#fca5a5',
                                }}
                              >
                                ⚠ {a}
                              </span>
                            ))
                          ) : (
                            <p className="font-sans text-xs text-fg-muted/70">Reviewing allergen details</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="font-sans text-xs text-fg-muted/70">Allergen details noted</p>
                )}
              </div>
            );
          }

          if (isActive && key === 'preferences') {
            const { likes, dislikes } = foodPrefs;
            return (
              <div key={key} className="rounded-xl p-5" style={{ background: 'var(--surface-2, var(--surface))' }}>
                <div className="flex items-center gap-2 mb-3">
                  <IcoHeart cls="h-4 w-4 shrink-0 text-amber-soft" />
                  <h3 className="font-serif text-base text-fg">Food Preferences</h3>
                </div>
                {likes.length > 0 && (
                  <div className="mb-2">
                    <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-fg-muted/55">Enjoys</p>
                    <div className="flex flex-wrap gap-1.5">
                      {likes.map((f) => (
                        <span key={f} className="rounded-md px-2.5 py-1 font-sans text-xs"
                          style={{ background: 'color-mix(in srgb, #16a34a 16%, var(--surface-2, var(--surface)))', color: '#86efac' }}>
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {dislikes.length > 0 && (
                  <div>
                    <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-fg-muted/55">Avoids</p>
                    <div className="flex flex-wrap gap-1.5">
                      {dislikes.map((f) => (
                        <span key={f} className="rounded-md px-2.5 py-1 font-sans text-xs"
                          style={{ background: 'color-mix(in srgb, #dc2626 16%, var(--surface-2, var(--surface)))', color: '#fca5a5' }}>
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {likes.length === 0 && dislikes.length === 0 && (
                  <p className="font-sans text-xs text-fg-muted/70 ml-[26px]">Preferences noted</p>
                )}
              </div>
            );
          }

          if (isActive && key === 'schedule') {
            return (
              <div key={key} className="rounded-xl p-5" style={{ background: 'var(--surface-2, var(--surface))' }}>
                <div className="flex items-center gap-2 mb-3">
                  <IcoClock cls="h-4 w-4 shrink-0 text-amber-soft" />
                  <h3 className="font-serif text-base text-fg">School Schedule</h3>
                </div>
                {schedule.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {schedule.map((item) => (
                      <span key={item} className="rounded-md px-2.5 py-1 font-sans text-xs"
                        style={{ background: 'color-mix(in srgb, var(--amber) 14%, var(--surface-2, var(--surface)))', color: 'var(--amber-soft, var(--amber))' }}>
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="font-sans text-xs text-fg-muted/70 ml-[26px]">Schedule noted</p>
                )}
              </div>
            );
          }

          if (isActive && key === 'cultural') {
            return (
              <div key={key} className="rounded-xl p-5" style={{ background: 'var(--surface-2, var(--surface))' }}>
                <div className="flex items-center gap-2 mb-3">
                  <IcoGlobe cls="h-4 w-4 shrink-0 text-amber-soft" />
                  <h3 className="font-serif text-base text-fg">Food Culture</h3>
                </div>
                {culturalPrefs.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {culturalPrefs.map((item) => (
                      <span key={item} className="rounded-md px-2.5 py-1 font-sans text-xs"
                        style={{ background: 'color-mix(in srgb, var(--amber) 14%, var(--surface-2, var(--surface)))', color: 'var(--amber-soft, var(--amber))' }}>
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="font-sans text-xs text-fg-muted/70 ml-[26px]">Cultural preferences noted</p>
                )}
              </div>
            );
          }

          if (isActive) {
            return (
              <div key={key} className="rounded-xl p-5" style={{ background: 'var(--surface-2, var(--surface))' }}>
                <div className="flex items-center gap-2.5 mb-2">
                  <Icon cls="h-4 w-4 shrink-0 text-amber-soft" />
                  <h3 className="font-serif text-base text-fg">{label}</h3>
                </div>
                <p className="font-sans text-xs text-fg-muted/70 ml-[26px]">Covered in conversation</p>
              </div>
            );
          }

          return (
            <div
              key={key}
              className="rounded-xl p-4 flex items-center gap-3.5"
              style={{ background: 'var(--surface)' }}
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'color-mix(in srgb, var(--amber) 12%, transparent)' }}
              >
                <Icon cls="h-[15px] w-[15px] text-amber/50" />
              </div>
              <div>
                <p className="font-sans text-sm font-medium text-fg/55">{waitingLabel}</p>
                <p className="font-sans text-[11px] mt-0.5 text-fg-muted/40">Still listening…</p>
              </div>
            </div>
          );
        })}

        {/* Slice 2.5-s7 — M3 taste card. Intentionally lean: rich rendering
            (cultural badges with enforcement borders, cuisine pills, dietary
            chips, food-pref counts) lands in 2.5-s11 when the Kitchen Profile
            reads from KitchenMapSchema live. This card acknowledges M3
            progress without re-introducing fragile transcript-heuristics. */}
        {m3TasteCapture.state !== 'none' ? (
          <div
            key="m3-taste"
            data-testid="m3-taste-card"
            className="rounded-xl p-5"
            style={{ background: 'var(--surface-2, var(--surface))' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <IcoGlobe cls="h-4 w-4 shrink-0 text-amber-soft" />
              <h3 className="font-serif text-base text-fg">Your kitchen&apos;s taste</h3>
            </div>
            {m3TasteCapture.state === 'capturing' && (
              <p className="font-sans text-xs italic text-fg-muted">
                Waiting on your response…
              </p>
            )}
            {m3TasteCapture.state === 'skipped' && (
              <p className="font-sans text-xs italic text-fg-muted">
                Skipped for now — you can tell Lumi anytime later.
              </p>
            )}
            {m3TasteCapture.state === 'partial' && (
              <p className="font-sans text-xs italic text-foliage">
                Noted — Lumi is building this in the background.
              </p>
            )}
          </div>
        ) : null}

        {/* Slice 2.5-s8 — M4 bag composition card. Lean by design: the
            structured per-child pattern read against KitchenMapSchema lives
            in 2.5-s11. This card acknowledges that the parent answered
            Moment 4 without re-introducing transcript heuristics. */}
        {m4BagCapture.state !== 'none' ? (
          <div
            key="m4-bag"
            data-testid="m4-bag-card"
            className={
              m4BagCapture.state === 'capturing'
                ? 'rounded-xl p-4 flex items-center gap-3.5'
                : 'rounded-xl p-5'
            }
            style={{
              background:
                m4BagCapture.state === 'capturing'
                  ? 'var(--surface)'
                  : 'var(--surface-2, var(--surface))',
            }}
          >
            {m4BagCapture.state === 'capturing' ? (
              <>
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'color-mix(in srgb, var(--amber) 12%, transparent)' }}
                >
                  <IcoLunchBag cls="h-[15px] w-[15px] text-amber/50" />
                </div>
                <div>
                  <p className="font-sans text-sm font-medium text-fg/55">What goes in the bag</p>
                  <p className="font-sans text-[11px] mt-0.5 text-fg-muted/40">Still listening…</p>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <IcoLunchBag cls="h-4 w-4 shrink-0 text-amber-soft" />
                  <h3 className="font-serif text-base text-fg">What goes in the bag</h3>
                </div>
                <p className="font-sans text-xs italic text-foliage">
                  Saved — Lumi knows how lunch travels.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* Progress footer */}
      <div className="shrink-0 px-7 pt-4 pb-7">
        <div className="flex items-center justify-between mb-3">
          <span className="font-sans text-[13px] text-fg-muted">
            {footerLabel}
          </span>
          <span className="font-serif text-base text-amber">
            {progressPct > 0 ? `${progressPct}%` : ''}
          </span>
        </div>
        <div
          className="h-0.5 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--surface-2, var(--surface))' }}
        >
          <div
            className="h-full rounded-full bg-amber transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

// Slice 2-S26 — `initialTurns` is the resume-mode entry point. When provided,
// the synthetic OPENING_GREETING is prepended exactly as on a fresh start
// (it's a client-render constant — the server intentionally excludes it from
// GET /v1/onboarding/state) and the prior real turns render in order beneath
// it. Without the prop the component renders the fresh-start transcript, so
// the existing 2-7 test suite and standalone usage are unaffected.
export function OnboardingText({ onFinalized, initialTurns }: OnboardingTextProps = {}) {
  const navigate = useNavigate();
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Slice 2.5-s3 — chip turn UX primitive. `chipConfig` holds the latest
  // Lumi-emitted chip suggestion (null when text-only). `chipSelections`
  // tracks the parent's current tap state; it is sent alongside the
  // textarea draft on the next turn and cleared on every successful
  // submission. Backend hardcodes `chip_config: null` until 2.5-s4 ships
  // the agent prompt that emits configs.
  const [chipConfig, setChipConfig] = useState<ChipConfig | null>(null);
  const [chipSelections, setChipSelections] = useState<string[]>([]);
  // Slice 2.5-s5 — server-emitted moment key (e.g. 'm1_table'). Starts null
  // until the first turn response arrives; in resume mode the panel falls
  // back to the topic-detection heuristic until the next turn fires.
  const [currentMomentKey, setCurrentMomentKey] = useState<string | null>(null);
  // Slice 2.5-s6 — Moment 2 primary capture snapshot for the profile panel.
  // Held outside the panel so the chip-level info (labels chosen) survives
  // moments after the parent advances past M2.
  const [m2AllergenCapture, setM2AllergenCapture] = useState<M2CaptureState>({ state: 'none' });
  // Slice 2.5-s7 — Moment 3 taste capture state for the panel "Your kitchen's
  // taste" card. Lean by design: the rich data-bound rendering belongs in
  // 2.5-s11's Kitchen Profile read against KitchenMapSchema.
  const [m3TasteCapture, setM3TasteCapture] = useState<M3TasteCaptureState>({ state: 'none' });
  // Slice 2.5-s8 — Moment 4 bag composition state for the "What goes in the
  // bag" card. Same lean approach as M3; structured per-child read lives in
  // 2.5-s11. Required-response gate, so no 'skipped' variant.
  const [m4BagCapture, setM4BagCapture] = useState<M4BagCaptureState>({ state: 'none' });
  const abortRef = useRef<AbortController | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  // In focused mode: show the last 2 turns (Lumi's question + user's last reply).
  // Earlier turns are collapsed behind the history toggle.
  const hiddenCount = showHistory ? 0 : Math.max(0, turns.length - 1);
  const userTurnCount = turns.filter((t) => t.role === 'user').length;
  const stepNumber = Math.min(userTurnCount + 1, 8);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setProfileOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const node = conversationEndRef.current;
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [turns.length, isComplete]);

  // Slice 2.5-s6 — when the agent advances into m2_safe for the first time,
  // flip the safety card from 'none' (hidden waiting card) to 'capturing'
  // (visible waiting card with "Waiting on your response…" copy). Subsequent
  // moments do not roll back the capture state — once the parent has
  // submitted, the card stays on the terminal state.
  useEffect(() => {
    if (currentMomentKey === 'm2_safe' && m2AllergenCapture.state === 'none') {
      setM2AllergenCapture({ state: 'capturing' });
    }
  }, [currentMomentKey, m2AllergenCapture.state]);

  // Slice 2.5-s7 — when the agent advances into m3_taste for the first time,
  // flip the taste card from 'none' (hidden) to 'capturing' (visible waiting
  // card). Subsequent moments do not roll back; the skip and advance-out
  // transitions are driven from submitTurn.
  useEffect(() => {
    if (currentMomentKey === 'm3_taste' && m3TasteCapture.state === 'none') {
      setM3TasteCapture({ state: 'capturing' });
    }
  }, [currentMomentKey, m3TasteCapture.state]);

  // Slice 2.5-s8 — when the agent advances into m4_bag for the first time,
  // flip the bag card from 'none' to 'capturing'. The 'captured' transition
  // is driven from submitTurn once the agent advances out of m4_bag (i.e.
  // moment_key becomes m5_starting_line or summary).
  useEffect(() => {
    if (currentMomentKey === 'm4_bag' && m4BagCapture.state === 'none') {
      setM4BagCapture({ state: 'capturing' });
    }
  }, [currentMomentKey, m4BagCapture.state]);

  // Slice 2.5-s5 — extracted from handleSubmit so the form submit and the
  // SkipChip onClick share the same POST + optimistic-render + rollback path.
  // No duplication; both entry points snapshot their inputs and forward here.
  const submitTurn = useCallback(
    async (chipSelectionsSnapshot: string[], draftSnapshot: string) => {
      const hasChipSelections = chipSelectionsSnapshot.length > 0;
      if (draftSnapshot.length === 0 && !hasChipSelections) return;
      if (pending) return;

      setError(null);
      setPending(true);

      // Optimistic transcript — when chips are present, render them as a
      // prefix on the user turn so the in-page history reflects what the
      // backend will see. Mirrors the server-side serializer in
      // apps/api/src/modules/onboarding/onboarding.routes.ts.
      const chipPrefix = hasChipSelections
        ? `[Chips selected: ${chipSelectionsSnapshot.join(', ')}]`
        : '';
      const optimisticContent = hasChipSelections
        ? draftSnapshot.length > 0
          ? `${chipPrefix} ${draftSnapshot}`
          : chipPrefix
        : draftSnapshot;
      const optimisticUserTurn: Turn = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: optimisticContent,
      };
      setTurns((prev) => [...prev, optimisticUserTurn]);

      // Clear local draft + chip state immediately; rollback below if needed.
      setDraft('');
      setChipSelections([]);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Slice 2.5-s3 — discriminate body shape on whether chips are active.
      const body: { message: string } | { chip_selections: string[]; text?: string } =
        hasChipSelections
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
          ...prev.map((t) => (t.id === optimisticUserTurn.id ? { ...t, id: parsed.turn_id } : t)),
          { id: parsed.lumi_turn_id, role: 'lumi', content: parsed.lumi_response },
        ]);
        setIsComplete(parsed.is_complete);
        // Slice 2.5-s6 — snapshot M2 chips for the profile-panel safety card
        // BEFORE chipConfig is reset by the new turn's chip_config. Uses the
        // chip selections + the *current* chipConfig (which describes M2's
        // 10 allergen options) to recover human-readable labels.
        if (currentMomentKey === 'm2_safe' && chipSelectionsSnapshot.length > 0) {
          if (chipSelectionsSnapshot.includes('none')) {
            setM2AllergenCapture({ state: 'all-clear' });
          } else {
            const labeled = chipSelectionsSnapshot.map((key) => {
              const label = chipConfig?.options?.find((o) => o.key === key)?.label ?? key;
              return { key, label };
            });
            setM2AllergenCapture({ state: 'declared', chips: labeled });
          }
        }
        // Slice 2.5-s7 — M3 taste card transitions. Skip chip → 'skipped'.
        // Agent advanced OUT of M3 → 'partial' (the actual capture lives in
        // the structured tables; this card just acknowledges progress).
        if (currentMomentKey === 'm3_taste') {
          if (chipSelectionsSnapshot.includes('skip')) {
            setM3TasteCapture({ state: 'skipped' });
          } else if (
            parsed.moment_key !== null &&
            parsed.moment_key !== undefined &&
            parsed.moment_key !== 'm3_taste'
          ) {
            setM3TasteCapture((prev) => (prev.state === 'partial' ? prev : { state: 'partial' }));
          }
        }
        // Slice 2.5-s8 — M4 bag card transitions to 'captured' when the agent
        // advances out of m4_bag. The captured snapshot prefers the parent's
        // chip selection (single-tap "same for every kid" path) and falls
        // back to per-child mode with an empty children list when the parent
        // free-typed prose — the structured per-child data is held in the
        // children rows and surfaced by 2.5-s11's Kitchen Profile live read.
        if (currentMomentKey === 'm4_bag') {
          const advancedOutOfM4 =
            parsed.moment_key !== null &&
            parsed.moment_key !== undefined &&
            parsed.moment_key !== 'm4_bag';
          if (advancedOutOfM4) {
            const chipPattern = chipSelectionsSnapshot[0];
            if (chipPattern !== undefined && chipSelectionsSnapshot.length === 1) {
              setM4BagCapture({ state: 'captured', mode: 'household', pattern: chipPattern as BagCompositionPattern });
            } else {
              setM4BagCapture({ state: 'captured', mode: 'per-child', children: [] });
            }
          }
        }
        setChipConfig(parsed.chip_config ?? null);
        // Slice 2.5-s5 — track the post-turn moment so the header renders the
        // correct "Moment X of 5" copy. null/undefined preserves the previous
        // moment so a transient drop doesn't flicker the header.
        setCurrentMomentKey(parsed.moment_key ?? null);
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
        // F11/F12 — only the 502 path leaves the user turn persisted server-side
        // (AC7). For every other failure the server did NOT save the message,
        // so roll back the optimistic render and restore both the draft text
        // and the chip selections so the user can re-send without re-tapping.
        if (!isUpstream) {
          setTurns((prev) => prev.filter((t) => t.id !== optimisticUserTurn.id));
          setDraft(draftSnapshot);
          setChipSelections(chipSelectionsSnapshot);
        }
      } finally {
        if (!controller.signal.aborted) {
          setPending(false);
        }
      }
    },
    [pending, currentMomentKey, chipConfig],
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
      // Story 2.8 — when the parent owns post-finalize navigation it passes
      // onFinalized. Without the prop, fall back to direct navigation so the
      // existing 2.7 test suite continues to pass and standalone use still works.
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

  return (
    <>
      {/* ── Two-column shell ─────────────────────────────────────────────── */}
      <div className="flex h-full w-full overflow-hidden">

        {/* LEFT: Conversation (60%) */}
        <section className="relative flex flex-1 md:w-[60%] md:flex-none flex-col bg-bg">

          {/* Header */}
          <header className="shrink-0 flex items-center justify-between bg-bg/80 px-6 md:px-8 py-5 backdrop-blur-sm">
            <div className="flex flex-col gap-1">
              <h1 className="font-serif text-xl font-medium tracking-tight text-amber">HiveKitchen</h1>
              <span className="font-sans text-[11px] font-medium uppercase tracking-widest text-fg-muted">
                {(() => {
                  // Slice 2.5-s5 — moment-based subtitle when the wire has
                  // surfaced a moment_key; otherwise fall back to the legacy
                  // step counter so resume-mode + pre-first-turn still read.
                  const meta = currentMomentKey ? MOMENT_CONFIG[currentMomentKey] : undefined;
                  if (meta !== undefined && meta.number > 0) {
                    return `Moment ${Math.min(meta.number, 5)} of 5 · ${meta.name}`;
                  }
                  return `Step ${stepNumber} of ~8`;
                })()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* History toggle */}
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                title={showHistory ? 'Collapse history' : 'Show conversation history'}
                className={[
                  'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
                  showHistory
                    ? 'border-amber/40 text-amber'
                    : 'border-border/50 text-fg-muted hover:text-fg',
                ].join(' ')}
              >
                <IcoHistory cls="h-[18px] w-[18px]" />
              </button>
              {/* Mobile: profile panel toggle */}
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                aria-label="Open your kitchen profile"
                className="md:hidden flex items-center gap-2 rounded-full border border-border/50 px-4 py-2 font-sans text-sm font-medium text-fg-muted hover:bg-surface transition-colors"
              >
                View Profile
              </button>
            </div>
          </header>

          {/* Conversation area */}
          <div className="flex flex-1 flex-col overflow-y-auto px-6 md:px-8 py-8">
            {/* History expansion button */}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory(true)}
                className="mb-8 self-center font-sans text-xs text-fg-muted hover:text-fg transition-colors"
              >
                ↑ {hiddenCount} earlier {hiddenCount === 1 ? 'message' : 'messages'}
              </button>
            )}

            {showHistory ? (
              /* ── Full history: traditional chat bubbles ── */
              <ol className="flex flex-col gap-4" aria-label="Onboarding conversation">
                {turns.map((turn) => (
                  <li
                    key={turn.id}
                    className={['flex', turn.role === 'lumi' ? 'justify-start' : 'justify-end'].join(' ')}
                  >
                    <div
                      className={[
                        'max-w-[85%] rounded-2xl px-4 py-3 text-base leading-relaxed',
                        turn.role === 'lumi'
                          ? 'bg-surface font-serif text-fg rounded-tl-sm'
                          : 'bg-surface-2 font-sans text-fg rounded-tr-sm',
                      ].join(' ')}
                    >
                      {turn.content}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              /* ── Focused view: one-question-at-a-time ── */
              <div className="flex flex-1 flex-col items-center justify-center gap-8 min-h-0">
                {/* Featured Lumi question — centered large. User turns are
                    hidden in focused mode; they appear only in history view. */}
                {(() => {
                  const lumiTurn = [...turns].reverse().find((t) => t.role === 'lumi');
                  if (pending && !lumiTurn) return null;
                  return (
                    <div className="flex flex-col items-center gap-6 text-center max-w-xl w-full">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/20 bg-amber/10">
                        <IcoWaveform cls="h-6 w-6 animate-pulse text-amber" />
                      </div>
                      <p className="font-serif text-2xl md:text-[28px] leading-snug text-fg">
                        {lumiTurn?.content ?? ''}
                      </p>

                      {/* Slice 2.5-s3 — chip slot. Renders below Lumi's prose
                          and above the input bar. Hint chips are illustrative
                          (no click); action/choice are interactive. The skip
                          chip only renders when the agent flagged this moment
                          as skippable. See chip-taxonomy-three-types memory. */}
                      {chipConfig &&
                        (
                          (chipConfig.mode === 'hint' && (chipConfig.hints?.length ?? 0) > 0) ||
                          ((chipConfig.mode === 'action' || chipConfig.mode === 'choice') &&
                            (chipConfig.options?.length ?? 0) > 0) ||
                          !!chipConfig.skip_label
                        ) && (
                        <div className="flex w-full flex-col items-center gap-2 pt-1">
                          {chipConfig.mode === 'hint' && chipConfig.hints && chipConfig.hints.length > 0 && (
                            <>
                              <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
                                Something like
                              </p>
                              <div className="flex flex-wrap justify-center gap-2">
                                {chipConfig.hints.map((hint) => (
                                  <HintChip key={hint} text={hint} />
                                ))}
                              </div>
                            </>
                          )}

                          {(chipConfig.mode === 'action' || chipConfig.mode === 'choice') &&
                            chipConfig.options && chipConfig.options.length > 0 && (
                              <>
                                <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
                                  {chipConfig.mode === 'action' ? 'Tap one' : 'Tap any that apply'}
                                </p>
                                <div
                                  role={chipConfig.mode === 'action' ? 'radiogroup' : 'group'}
                                  aria-label="Suggested replies"
                                  className="flex flex-wrap justify-center gap-2"
                                >
                                  {chipConfig.options.map((opt) => (
                                    <ChoiceChip
                                      key={opt.key}
                                      label={opt.label}
                                      mode={chipConfig.mode === 'action' ? 'single' : 'multi'}
                                      selected={chipSelections.includes(opt.key)}
                                      onClick={() => {
                                        if (chipConfig.mode === 'action') {
                                          setChipSelections([opt.key]);
                                          return;
                                        }
                                        // Slice 2.5-s6 — M2 safety wall: 'none'
                                        // is mutually exclusive with allergen
                                        // chips. Tapping 'none' clears every-
                                        // thing else; tapping any allergen
                                        // clears 'none'.
                                        if (currentMomentKey === 'm2_safe') {
                                          setChipSelections((prev) => {
                                            if (opt.key === 'none') {
                                              return prev.includes('none') ? [] : ['none'];
                                            }
                                            const withoutNone = prev.filter((k) => k !== 'none');
                                            return withoutNone.includes(opt.key)
                                              ? withoutNone.filter((k) => k !== opt.key)
                                              : [...withoutNone, opt.key];
                                          });
                                          return;
                                        }
                                        setChipSelections((prev) =>
                                          prev.includes(opt.key)
                                            ? prev.filter((k) => k !== opt.key)
                                            : [...prev, opt.key],
                                        );
                                      }}
                                    />
                                  ))}
                                </div>
                              </>
                            )}

                          {chipConfig.skip_label && (
                            <div className="pt-1">
                              <SkipChip
                                label={chipConfig.skip_label}
                                disabled={pending}
                                onClick={() => {
                                  // Slice 2.5-s5 — fire an immediate chip turn
                                  // with the literal "skip" selection so the
                                  // v2 agent prompt advances the moment.
                                  void submitTurn(['skip'], '');
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Typing indicator */}
                {pending && (
                  <div className="flex items-center justify-center gap-1.5" aria-label="Lumi is thinking">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="h-2 w-2 animate-bounce rounded-full bg-fg-muted"
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div ref={conversationEndRef} aria-hidden="true" />
          </div>

          {/* Error */}
          {error && (
            <p className="shrink-0 px-6 md:px-8 py-2 font-sans text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          {/* Completion CTA — F07: keep visible even when error is set */}
          {isComplete && (
            <div className="shrink-0 flex flex-col items-center gap-2 px-6 md:px-8 pt-2 pb-6">
              <button
                type="button"
                onClick={handleFinalize}
                disabled={finalizing}
                className="rounded-full bg-amber px-8 py-3 font-sans text-base text-bg hover:bg-amber-warm disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
              >
                {finalizing ? 'Finishing…' : 'Finish onboarding'}
              </button>
              <p className="font-sans text-xs text-fg-muted">Lumi has everything needed.</p>
            </div>
          )}

          {/* Input bar — pill-shaped */}
          {!isComplete && (
            <form onSubmit={handleSubmit} className="shrink-0 px-6 md:px-8 pb-10 pt-4">
              <label htmlFor="onboarding-message" className="sr-only">
                Your message to Lumi
              </label>
              <div className="flex items-center gap-2 rounded-2xl border border-border/20 bg-surface/50 px-2 py-1.5 backdrop-blur-md focus-within:border-amber/50 transition-colors shadow-lg">
                <textarea
                  id="onboarding-message"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={1}
                  maxLength={4000}
                  // Slice 2.5-s3 — placeholder dims when chips are present so
                  // they read as primary input; textarea becomes the optional
                  // "add a note" channel.
                  // Slice 2.5-s6 — M2 placeholder asks the parent to add
                  // context (which child, severity) alongside the chips.
                  placeholder={
                    currentMomentKey === 'm2_safe'
                      ? 'Add details — which child, severity, anything special I should know…'
                      : chipConfig
                        ? 'Add a note…'
                        : 'Type your answer...'
                  }
                  disabled={pending}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSubmit(e as unknown as React.FormEvent);
                    }
                  }}
                  className="flex-1 resize-none bg-transparent px-4 py-2 font-sans text-[17px] text-fg placeholder:text-fg-muted/40 focus:outline-none disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={
                    pending || (draft.trim().length === 0 && chipSelections.length === 0)
                  }
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber text-bg shadow-md hover:bg-amber-warm disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                  aria-label="Send"
                >
                  {pending ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-bg border-t-transparent" />
                  ) : (
                    <IcoSend cls="h-5 w-5" />
                  )}
                </button>
              </div>
              {/* Slice 2.5-s3 — micro-confirmation below the pill form. Copy
                  matches Moment1Page.tsx so the live onboarding surface and
                  the mockup read identically once 2.5-s4 lights up chips.
                  Slice 2.5-s6 — M2 (safety wall) has a Required-mode prompt
                  and an "all clear" confirmation in addition to the generic
                  count copy. */}
              {(() => {
                if (currentMomentKey === 'm2_safe') {
                  const hasResponse =
                    chipSelections.length > 0 || draft.trim().length > 0;
                  if (!hasResponse) {
                    return (
                      <p
                        data-testid="m2-status-line"
                        className="mt-2 text-center font-sans text-xs italic text-amber/80"
                      >
                        Required — tap an allergen, describe in your own words,
                        or pick &ldquo;No known allergens&rdquo;.
                      </p>
                    );
                  }
                  if (chipSelections.includes('none')) {
                    return (
                      <p
                        data-testid="m2-status-line"
                        className="mt-2 text-center font-sans text-xs italic text-foliage"
                      >
                        No known allergens — confirmed
                      </p>
                    );
                  }
                  if (chipSelections.length > 0) {
                    return (
                      <p
                        data-testid="m2-status-line"
                        className="mt-2 text-center font-sans text-xs italic text-foliage"
                      >
                        {chipSelections.length === 1
                          ? '1 selection will be sent with your message'
                          : `${chipSelections.length} selections will be sent with your message`}
                      </p>
                    );
                  }
                  return null;
                }
                if (chipSelections.length > 0) {
                  return (
                    <p className="mt-2 text-center font-sans text-xs italic text-foliage">
                      {chipSelections.length === 1
                        ? '1 selection will be sent with your message'
                        : `${chipSelections.length} selections will be sent with your message`}
                    </p>
                  );
                }
                return null;
              })()}
              {/* Visible send label for screen-readers / tests */}
              <span className="sr-only">Send</span>
            </form>
          )}
        </section>

        {/* RIGHT: Profile panel (desktop only, 40%) */}
        <section
          className="relative hidden md:flex md:w-[40%] flex-col bg-surface overflow-hidden"
          aria-label="Your Kitchen Profile"
        >
          {/* Subtle gradient overlay from Stitch design */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-surface to-bg opacity-50" />
          <div className="relative flex flex-1 flex-col overflow-hidden z-10">
            <KitchenProfilePanel
              turns={turns}
              currentMomentKey={currentMomentKey}
              m2AllergenCapture={m2AllergenCapture}
              m3TasteCapture={m3TasteCapture}
              m4BagCapture={m4BagCapture}
            />
          </div>
        </section>
      </div>

      {/* ── Mobile slide-up profile drawer ───────────────────────────────── */}
      <div
        className={[
          'fixed inset-0 z-40 md:hidden transition-opacity duration-300',
          profileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      >
        <div
          className="absolute inset-0 bg-black/60"
          onClick={() => setProfileOpen(false)}
          aria-hidden="true"
        />
        <div
          role="dialog"
          aria-label="Your Kitchen Profile"
          className={[
            'absolute bottom-0 left-0 right-0 flex flex-col rounded-t-2xl bg-bg overflow-hidden max-h-[85vh] transition-transform duration-300 ease-out',
            profileOpen ? 'translate-y-0' : 'translate-y-full',
          ].join(' ')}
        >
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>
          <div className="flex justify-end px-5 pb-1 shrink-0">
            <button
              type="button"
              onClick={() => setProfileOpen(false)}
              className="font-sans text-xs text-fg-muted hover:text-fg transition-colors"
              aria-label="Close profile panel"
            >
              Close
            </button>
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">
            <KitchenProfilePanel
              turns={turns}
              currentMomentKey={currentMomentKey}
              m2AllergenCapture={m2AllergenCapture}
              m3TasteCapture={m3TasteCapture}
              m4BagCapture={m4BagCapture}
            />
          </div>
        </div>
      </div>
    </>
  );
}
