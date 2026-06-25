import { describe, it, expect } from 'vitest';
import { PLANNER_PROMPT } from './planner.prompt.js';

describe('PLANNER_PROMPT', () => {
  it('has a semver-shaped version string', () => {
    expect(PLANNER_PROMPT.version).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('exposes the canonical 4-tool allow-list in the specified order (Story 3-S36: child_signal + pantry.read removed)', () => {
    expect(PLANNER_PROMPT.toolsAllowed).toEqual([
      'recipe.search',
      'recipe.fetch',
      'recipe.discover',
      'plan.compose',
    ]);
  });

  it('exposes a non-trivial prompt body', () => {
    expect(PLANNER_PROMPT.text.length).toBeGreaterThan(100);
  });

  it('does not include memory.note (write tool) in the planner allow-list', () => {
    expect(PLANNER_PROMPT.toolsAllowed).not.toContain('memory.note');
  });

  it('does not include memory.recall, cultural.lookup, or allergy.check (Story 3-S32: pre-loaded in context)', () => {
    expect(PLANNER_PROMPT.toolsAllowed).not.toContain('memory.recall');
    expect(PLANNER_PROMPT.toolsAllowed).not.toContain('cultural.lookup');
    expect(PLANNER_PROMPT.toolsAllowed).not.toContain('allergy.check');
  });

  // Story 3-S36 — child_signal + pantry.read pre-loaded as context blocks and
  // removed from the tool loop; the three recipe tools stay (fallback-only).
  it('does not include child_signal or pantry.read (Story 3-S36: pre-loaded in context)', () => {
    expect(PLANNER_PROMPT.toolsAllowed).not.toContain('child_signal');
    expect(PLANNER_PROMPT.toolsAllowed).not.toContain('pantry.read');
  });

  it('retains the three recipe tools as fallback (Story 3-S36)', () => {
    expect(PLANNER_PROMPT.toolsAllowed).toContain('recipe.search');
    expect(PLANNER_PROMPT.toolsAllowed).toContain('recipe.fetch');
    expect(PLANNER_PROMPT.toolsAllowed).toContain('recipe.discover');
  });

  it('instructs the planner not to call the pre-loaded read tools', () => {
    expect(PLANNER_PROMPT.text).toContain('DO NOT call child_signal');
    expect(PLANNER_PROMPT.text).toContain('DO NOT call pantry.read');
    expect(PLANNER_PROMPT.text).toContain('<recipe_candidates>');
  });

  it('demotes the recipe tools to fallback-only', () => {
    expect(PLANNER_PROMPT.text).toContain('FALLBACK ONLY');
  });

  it('is at version v2.9.0', () => {
    expect(PLANNER_PROMPT.version).toBe('v2.9.0');
  });

  // Story 3-S33 — no-consecutive-Main distribution rule.
  it('documents the no-consecutive-Main distribution rule', () => {
    expect(PLANNER_PROMPT.text).toContain('Main distribution rule');
    expect(PLANNER_PROMPT.text).toContain(
      'NO two consecutive days may share the same Main',
    );
    expect(PLANNER_PROMPT.text).toContain('A 2-day plan uses 2 distinct Mains');
    expect(PLANNER_PROMPT.text).toContain('M1, M2, M1, M3, M2');
  });

  it('no longer defaults to the 3-Main consecutive-pairing pattern', () => {
    expect(PLANNER_PROMPT.text).not.toContain('M1 Mon+Tue, M2 Wed+Thu, M3 Fri-flex');
  });

  it('documents the FR125 absence-neutrality rule for child_signal', () => {
    expect(PLANNER_PROMPT.text).toContain('child_signal');
    expect(PLANNER_PROMPT.text).toContain('absence of a signal entry is neutral data');
  });

  // Story 3-S32 review — the prompt body must not instruct the model to CALL the
  // three removed tools. Negative "do not call ..." directives are fine; the
  // affirmative call-directive phrasings below are the stale references the
  // removal must purge (a stale "fails allergy.check" line slipped through once).
  it('carries no affirmative call-directives for the removed tools', () => {
    expect(PLANNER_PROMPT.text).not.toMatch(/Use cultural\.lookup/);
    expect(PLANNER_PROMPT.text).not.toMatch(/Use memory\.recall/);
    expect(PLANNER_PROMPT.text).not.toMatch(/Call allergy\.check/);
    expect(PLANNER_PROMPT.text).not.toMatch(/fails allergy\.check/);
    // Confirm the explicit "do not call" guidance is present.
    expect(PLANNER_PROMPT.text).toContain(
      'DO NOT call memory.recall, cultural.lookup, or allergy.check',
    );
  });
});
