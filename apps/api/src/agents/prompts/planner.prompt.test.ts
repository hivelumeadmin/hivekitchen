import { describe, it, expect } from 'vitest';
import { PLANNER_PROMPT } from './planner.prompt.js';

describe('PLANNER_PROMPT', () => {
  it('has a semver-shaped version string', () => {
    expect(PLANNER_PROMPT.version).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('exposes the canonical 7-tool allow-list in the specified order', () => {
    expect(PLANNER_PROMPT.toolsAllowed).toEqual([
      'recipe.search',
      'recipe.fetch',
      'memory.recall',
      'pantry.read',
      'plan.compose',
      'allergy.check',
      'cultural.lookup',
    ]);
  });

  it('exposes a non-trivial prompt body', () => {
    expect(PLANNER_PROMPT.text.length).toBeGreaterThan(100);
  });

  it('does not include memory.note (write tool) in the planner allow-list', () => {
    expect(PLANNER_PROMPT.toolsAllowed).not.toContain('memory.note');
  });
});
