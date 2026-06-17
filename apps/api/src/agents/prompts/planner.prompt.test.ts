import { describe, it, expect } from 'vitest';
import { PLANNER_PROMPT } from './planner.prompt.js';

describe('PLANNER_PROMPT', () => {
  it('has a semver-shaped version string', () => {
    expect(PLANNER_PROMPT.version).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('exposes the canonical 6-tool allow-list in the specified order (Story 3-S32: memory.recall, cultural.lookup, allergy.check removed)', () => {
    expect(PLANNER_PROMPT.toolsAllowed).toEqual([
      'recipe.search',
      'recipe.fetch',
      'recipe.discover',
      'pantry.read',
      'plan.compose',
      'child_signal',
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

  it('is at version v2.5.0', () => {
    expect(PLANNER_PROMPT.version).toBe('v2.5.0');
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
