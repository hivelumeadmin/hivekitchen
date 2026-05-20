/**
 * Mockup-only cumulative chat history. Each moment shows the conversation
 * leading up to it when the history toggle is pressed.
 *
 * In production this data comes from the agent backend (`thread_turns`).
 * For the mockup it lives here so all five moment pages stay narratively
 * coherent — tweak a parent response in Moment 1 and Moments 2-5 reflect it.
 */

export interface ChatTurn {
  readonly id: string;
  readonly role: 'lumi' | 'parent';
  readonly content: string;
}

// Moment 1 — first turn of the entire flow. No prior history.
const MOMENT_1_LUMI: ChatTurn = {
  id: 'm1-lumi',
  role: 'lumi',
  content:
    "Hi, Priya. Welcome to your kitchen. Let's start with who's at the table — what should I call your household, and who are you creating lunches for?",
};

// Parent's Moment 1 response (the rich answer the agent extracts from).
const MOMENT_1_PARENT: ChatTurn = {
  id: 'm1-parent',
  role: 'parent',
  content:
    "Khan-Patel family kitchen. Two kids — Layla, she's 10, and Adam, he just turned 12.",
};

const MOMENT_2_LUMI: ChatTurn = {
  id: 'm2-lumi',
  role: 'lumi',
  content:
    "Alright — two kids, Layla and Adam. Anything I have to keep safe from? Any food allergies or sensitivities for either of them? Tap any that apply, type your own, or let me know if there are none.",
};

const MOMENT_2_PARENT: ChatTurn = {
  id: 'm2-parent',
  role: 'parent',
  content:
    "Layla is the one with the nut allergies — peanut and tree nuts, medical, life-threatening. Adam has no allergies.",
};

const MOMENT_3_LUMI: ChatTurn = {
  id: 'm3-lumi',
  role: 'lumi',
  content:
    "Got it — Layla's nut allergies noted and treated as hard rules. Now tell me how your kitchen tastes — what flavors live in your house? Anything I should lean into or stay clear of?",
};

const MOMENT_3_PARENT: ChatTurn = {
  id: 'm3-parent',
  role: 'parent',
  content:
    "We're strictly Halal — that's non-negotiable. Mostly Punjabi cooking at home, the kids love their dal-chawal and parathas. We do try other things too — Italian pasta nights, the occasional sushi.",
};

const MOMENT_3_LUMI_FOLLOWUP: ChatTurn = {
  id: 'm3-lumi-followup',
  role: 'lumi',
  content:
    "Got it — &ldquo;strictly Halal.&rdquo; Should I treat that as a hard rule I always respect, or more like a preference?",
};

const MOMENT_3_PARENT_FOLLOWUP: ChatTurn = {
  id: 'm3-parent-followup',
  role: 'parent',
  content: 'Always respect — never anything non-Halal.',
};

const MOMENT_4_LUMI: ChatTurn = {
  id: 'm4-lumi',
  role: 'lumi',
  content:
    "Now — how does lunch usually travel in your house? Same kind of pack for both Layla and Adam, or different?",
};

const MOMENT_4_PARENT: ChatTurn = {
  id: 'm4-parent',
  role: 'parent',
  content: 'Same for both — main + two sides. They each take a lunchbox with one main thing and a couple of small bits.',
};

const MOMENT_5_LUMI: ChatTurn = {
  id: 'm5-lumi',
  role: 'lumi',
  content:
    "Last one — give me a starting line. Ten lunches you'd happily pack tomorrow. Tap from the list, or type your own. Lumi will mix it up from here.",
};

const MOMENT_5_PARENT: ChatTurn = {
  id: 'm5-parent',
  role: 'parent',
  content:
    "Paratha roll, dal-rice thermos, wrap, pasta salad, hummus and pita, quesadilla, rice bowl, noodle box, bagel and spread — and a chicken kebab with naan.",
};

// Moment 6 — Summary read-back. Lumi reads the captured kitchen back and asks
// the parent to confirm anything she's about to treat as a hard rule.
const MOMENT_6_LUMI: ChatTurn = {
  id: 'm6-lumi',
  role: 'lumi',
  content:
    "Here's what I heard. A couple of these I want to treat as hard rules — confirm each one, tweak what's off, and I'll lock the kitchen in.",
};

// ─── Cumulative history per moment ─────────────────────────────────────────
// Each array represents the conversation history BEFORE the current moment's
// Lumi turn — the prior exchanges that brought the parent to this point.
// The current Lumi turn is added on top of this in the HistoryView when
// rendering, so the final bubble list reads as a complete conversation.

export const PRIOR_HISTORY_MOMENT_1: readonly ChatTurn[] = [];

export const PRIOR_HISTORY_MOMENT_2: readonly ChatTurn[] = [
  MOMENT_1_LUMI,
  MOMENT_1_PARENT,
];

export const PRIOR_HISTORY_MOMENT_3: readonly ChatTurn[] = [
  MOMENT_1_LUMI,
  MOMENT_1_PARENT,
  MOMENT_2_LUMI,
  MOMENT_2_PARENT,
];

export const PRIOR_HISTORY_MOMENT_4: readonly ChatTurn[] = [
  MOMENT_1_LUMI,
  MOMENT_1_PARENT,
  MOMENT_2_LUMI,
  MOMENT_2_PARENT,
  MOMENT_3_LUMI,
  MOMENT_3_PARENT,
  MOMENT_3_LUMI_FOLLOWUP,
  MOMENT_3_PARENT_FOLLOWUP,
];

export const PRIOR_HISTORY_MOMENT_5: readonly ChatTurn[] = [
  MOMENT_1_LUMI,
  MOMENT_1_PARENT,
  MOMENT_2_LUMI,
  MOMENT_2_PARENT,
  MOMENT_3_LUMI,
  MOMENT_3_PARENT,
  MOMENT_3_LUMI_FOLLOWUP,
  MOMENT_3_PARENT_FOLLOWUP,
  MOMENT_4_LUMI,
  MOMENT_4_PARENT,
];

export const PRIOR_HISTORY_MOMENT_6: readonly ChatTurn[] = [
  MOMENT_1_LUMI,
  MOMENT_1_PARENT,
  MOMENT_2_LUMI,
  MOMENT_2_PARENT,
  MOMENT_3_LUMI,
  MOMENT_3_PARENT,
  MOMENT_3_LUMI_FOLLOWUP,
  MOMENT_3_PARENT_FOLLOWUP,
  MOMENT_4_LUMI,
  MOMENT_4_PARENT,
  MOMENT_5_LUMI,
  MOMENT_5_PARENT,
];

// Re-exports for convenience — moments may want to know their own seeded Lumi turn
export {
  MOMENT_1_LUMI,
  MOMENT_2_LUMI,
  MOMENT_3_LUMI,
  MOMENT_4_LUMI,
  MOMENT_5_LUMI,
  MOMENT_6_LUMI,
};
