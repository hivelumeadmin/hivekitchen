import { describe, it, expect } from 'vitest';
import { PLANNER_PROMPT } from './planner.prompt.js';

describe('PLANNER_PROMPT', () => {
  it('has a semver-shaped version string', () => {
    expect(PLANNER_PROMPT.version).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('exposes the canonical 9-tool allow-list in the specified order', () => {
    expect(PLANNER_PROMPT.toolsAllowed).toEqual([
      'recipe.search',
      'recipe.fetch',
      'recipe.discover',
      'memory.recall',
      'pantry.read',
      'plan.compose',
      'allergy.check',
      'cultural.lookup',
      'child_signal',
    ]);
  });

  it('exposes a non-trivial prompt body', () => {
    expect(PLANNER_PROMPT.text.length).toBeGreaterThan(100);
  });

  it('does not include memory.note (write tool) in the planner allow-list', () => {
    expect(PLANNER_PROMPT.toolsAllowed).not.toContain('memory.note');
  });

  // Story 4-S11 — version bump + child_signal preference-bias block.
  it('is at version v2.1.0', () => {
    expect(PLANNER_PROMPT.version).toBe('v2.1.0');
  });

  it('documents the FR125 absence-neutrality rule for child_signal', () => {
    expect(PLANNER_PROMPT.text).toContain('child_signal');
    expect(PLANNER_PROMPT.text).toContain('absence of a signal entry is neutral data');
  });
});
