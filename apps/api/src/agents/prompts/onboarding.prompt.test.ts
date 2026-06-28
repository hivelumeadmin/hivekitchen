import { describe, it, expect } from 'vitest';
import { getOnboardingSystemPrompt, ONBOARDING_SYSTEM_PROMPT } from './onboarding.prompt.js';

// ===========================================================================
// Slice 2.5-s4 — prompt v2 structural assertions
// ===========================================================================
// These tests guard the v2 text prompt's load-bearing pieces (moment list,
// directive syntax, chip-turn understanding, finalize gate, tool inventory).
// Wording within each section may evolve; the assertions look for the
// well-known phrases the runtime depends on so a rewrite that drops them
// fails loudly here rather than silently in production.

describe('getOnboardingSystemPrompt("text") — v2', () => {
  const prompt = getOnboardingSystemPrompt('text');

  it('no longer instructs the model to emit control directives (Slice 2.7-s7 — controller owns the FSM)', () => {
    expect(prompt).not.toContain('[NEXT_MOMENT:');
    expect(prompt).not.toContain('[CHIP_PROMPT:');
  });

  it('documents the five moment keys', () => {
    expect(prompt).toContain('m1_table');
    expect(prompt).toContain('m2_safe');
    expect(prompt).toContain('m3_taste');
    expect(prompt).toContain('m4_bag');
    expect(prompt).toContain('m5_starting_line');
    expect(prompt).toContain('summary');
  });

  it('teaches the chip-turn input format', () => {
    expect(prompt).toContain('[Chips selected:');
    expect(prompt).toContain('no_known_allergens');
    expect(prompt).toContain('[Chips selected: skip]');
  });

  it('names the finalize gate (required_set_complete)', () => {
    expect(prompt).toContain('required_set_complete');
  });

  it('explains multi-tool parallel inference', () => {
    expect(prompt).toMatch(/parallel|same response turn|one turn/i);
  });

  it('mentions every one of the 11 tools', () => {
    const tools = [
      'household.set_name',
      'child.upsert',
      'allergen.declare',
      'cultural.note',
      'cuisine.declare',
      'dietary.declare',
      'food_preference.declare',
      'rule.set',
      'favorite_lunch.add',
      'household.upsert',
      'memory.note',
    ];
    for (const tool of tools) {
      expect(prompt).toContain(tool);
    }
  });

  it('reinforces anti-narration (no announcing moment transitions)', () => {
    expect(prompt.toLowerCase()).toContain('do not narrate');
  });

  it('tells the model the system owns control flow and it emits no control tokens (Slice 2.7-s7)', () => {
    expect(prompt.toLowerCase()).toContain('the system advances');
    expect(prompt.toLowerCase()).toContain('never emit any control token');
  });

  // ---- Story 12-S9 / D2 patch: Lumi identity guard --------
  // Onboarding uses a standalone identity sentence ("You are Lumi, a warm family lunch
  // companion."), NOT the full LUMI_BASE_PERSONA. The full persona says "You know this
  // family — their children by name, their allergen constraints..." which is wrong during
  // onboarding (Lumi is still discovering the family). These guards verify the identity
  // sentence and load-bearing content survive edits.

  it('contains the Lumi identity sentence (12-S9/D2)', () => {
    expect(prompt).toContain('You are Lumi');
  });

  it('no longer carries the moment-advance directive (Slice 2.7-s7 — controller owns the FSM)', () => {
    expect(prompt).not.toContain('[NEXT_MOMENT:');
  });

  // ---- Slice 2.7-s5: enforcement ratification via tool field ------------

  it('teaches request_ratification on the dietary/cuisine tools, not a prose sentinel', () => {
    expect(prompt).toContain('request_ratification');
    // The legacy [CHIP_PROMPT:elevation:...] sentinel is gone.
    expect(prompt).not.toContain('[CHIP_PROMPT:elevation:');
  });

  it('scopes request_ratification to dietary.declare / cuisine.declare', () => {
    expect(prompt).toMatch(/request_ratification only\s+has an effect on dietary\.declare and cuisine\.declare/);
  });

  it('documents the three elevation chip keys and their enforcement mapping', () => {
    expect(prompt).toContain('always-respect');
    expect(prompt).toContain('prefer');
    expect(prompt).toContain('just-context');
    // The non_negotiable / strong / just_for_context mapping appears in the
    // directive doc. Assert at least the non-negotiable mapping line.
    expect(prompt).toContain("enforcement='non_negotiable'");
    expect(prompt).toContain("enforcement='just_for_context'");
  });
});

describe('getOnboardingSystemPrompt("voice") — unchanged', () => {
  const prompt = getOnboardingSystemPrompt('voice');

  it('does not carry the v2 moment-advance directive', () => {
    expect(prompt).not.toContain('[NEXT_MOMENT:');
  });

  it('still uses the three-signal-questions framing', () => {
    expect(prompt.toLowerCase()).toContain('grandmother');
    expect(prompt.toLowerCase()).toContain('friday');
  });

  it('still includes the SESSION_COMPLETE sentinel rule', () => {
    expect(prompt).toContain('[SESSION_COMPLETE]');
  });

  it('contains the Lumi identity sentence (12-S9/D2)', () => {
    expect(prompt).toContain('You are Lumi');
  });

  it('does not carry the Slice 2.5-s7 elevation CHIP_PROMPT directive', () => {
    expect(prompt).not.toContain('[CHIP_PROMPT:');
  });
});

describe('ONBOARDING_SYSTEM_PROMPT back-compat export', () => {
  it('returns the voice prompt (back-compat for CulturalPriorService etc.)', () => {
    expect(ONBOARDING_SYSTEM_PROMPT).toBe(getOnboardingSystemPrompt('voice'));
  });
});
