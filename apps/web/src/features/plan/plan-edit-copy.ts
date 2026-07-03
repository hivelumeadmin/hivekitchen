import type { PlanEditResult } from '@hivekitchen/types';

// Epic 13-s10 — the valet's voice for conversational plan edits. Warm, brief,
// never chatbot filler. One module so copy stays consistent and testable; the
// panel renders these lines, never inlines its own.

// A clarify reason maps to a friendly line plus the deterministic recovery
// affordance the panel should offer (zero-LLM chips, or a plain re-prompt).
export type ClarifyChipKind = 'day' | 'child' | 'none';

export interface ClarifyCopy {
  line: string;
  chips: ClarifyChipKind;
}

const CLARIFY: Record<string, ClarifyCopy> = {
  day_required: { line: 'Which day did you mean?', chips: 'day' },
  day_not_found: { line: "I couldn't place that day — which one?", chips: 'day' },
  child_required: { line: 'Which child is this for?', chips: 'child' },
  unknown_child: { line: "I don't have that child on file — who did you mean?", chips: 'child' },
  day_paused: { line: "That day's paused, so there's nothing to change there.", chips: 'none' },
  slot_not_found: { line: "I couldn't find that on the plan — mind saying it another way?", chips: 'none' },
  variation_not_found: { line: "That child doesn't have a portion on that day to adjust.", chips: 'none' },
  unknown_variation: { line: "I didn't catch how to change it — smaller, milder, softer?", chips: 'none' },
  unclear: { line: "I didn't quite catch that — could you say it another way?", chips: 'none' },
};

const CLARIFY_FALLBACK: ClarifyCopy = {
  line: "I didn't quite catch that — could you say it another way?",
  chips: 'none',
};

export function clarifyCopy(reason: string): ClarifyCopy {
  return CLARIFY[reason] ?? CLARIFY_FALLBACK;
}

// An escalate result is the confirm gate. Copy is reason-specific and always
// makes the cost/time explicit — nothing fires without an explicit confirm tap.
export interface EscalateCopy {
  line: string;
  confirmLabel: string;
  declineLabel: string;
}

const ESCALATE: Record<string, EscalateCopy> = {
  catalog_miss: {
    line: "I don't have anything cached that fits — want me to draft something new? It'll take a minute.",
    confirmLabel: 'Draft something new',
    declineLabel: 'Not now',
  },
  add_dish: {
    line: "That's not in your kitchen yet — want me to go find it? It'll take a minute.",
    confirmLabel: 'Find it for me',
    declineLabel: 'Not now',
  },
  recompose: {
    line: 'Redoing the whole week is the slow path — want me to go ahead? It takes about a minute.',
    confirmLabel: 'Redraft the week',
    declineLabel: 'Not now',
  },
  compose_next: {
    line: 'Want me to draft next week? It takes about a minute.',
    confirmLabel: 'Draft next week',
    declineLabel: 'Not now',
  },
};

export function escalateCopy(reason: string): EscalateCopy {
  return (
    ESCALATE[reason as keyof typeof ESCALATE] ?? {
      line: 'Want me to work on that? It takes about a minute.',
      confirmLabel: 'Go ahead',
      declineLabel: 'Not now',
    }
  );
}

// The warm acknowledgement line for a result that landed (or was noted). dayLabel
// is the tapped day's display label when the panel has one.
export function resultCopy(result: PlanEditResult, dayLabel?: string): string {
  const where = dayLabel ? ` ${dayLabel}` : '';
  switch (result.status) {
    case 'applied':
      switch (result.action) {
        case 'swap_main':
          return `Done — swapped the main${where ? ` for${where}` : ''}.`;
        case 'swap_slot':
          return `Done — that slot's updated${where ? ` for${where}` : ''}.`;
        case 'swap_snack':
          return `Done — new snack${where ? ` for${where}` : ''}.`;
        case 'vary':
          return 'Done — adjusted that portion.';
        case 'safety_write': {
          const fixed = result.fixed_slots?.length ?? 0;
          if (fixed > 0) {
            return `Noted — I've added that allergy and re-picked ${fixed} ${fixed === 1 ? 'dish' : 'dishes'} to keep the week safe.`;
          }
          return "Noted — I've added that allergy and the week's already clear of it.";
        }
      }
      return 'Done.';
    case 'acknowledged':
      return result.action === 'commit' ? "Confirmed — your week's set." : 'Got it.';
    case 'read':
      return "Here's what I have.";
    // clarify / escalate are rendered by their own paths, not this line.
    case 'clarify':
      return clarifyCopy(result.reason).line;
    case 'escalate':
      return escalateCopy(result.reason).line;
  }
}
