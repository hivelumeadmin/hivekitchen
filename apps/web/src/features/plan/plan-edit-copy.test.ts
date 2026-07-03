import { describe, it, expect } from 'vitest';
import { clarifyCopy, escalateCopy, resultCopy } from './plan-edit-copy.js';

// Epic 13-s10 — the plan-edit copy map (valet voice); pure, fixture-tested.

describe('clarifyCopy', () => {
  it('maps day reasons to day chips', () => {
    expect(clarifyCopy('day_required').chips).toBe('day');
    expect(clarifyCopy('day_not_found').chips).toBe('day');
  });

  it('maps child reasons to child chips', () => {
    expect(clarifyCopy('child_required').chips).toBe('child');
    expect(clarifyCopy('unknown_child').chips).toBe('child');
  });

  it('maps re-prompt reasons to no chips', () => {
    for (const r of ['day_paused', 'slot_not_found', 'variation_not_found', 'unknown_variation']) {
      expect(clarifyCopy(r).chips).toBe('none');
    }
  });

  it('falls back gracefully for an unknown reason', () => {
    const copy = clarifyCopy('some_future_reason');
    expect(copy.chips).toBe('none');
    expect(copy.line.length).toBeGreaterThan(0);
  });
});

describe('escalateCopy', () => {
  it('has reason-specific confirm labels', () => {
    expect(escalateCopy('recompose').confirmLabel).toMatch(/redraft/i);
    expect(escalateCopy('compose_next').confirmLabel).toMatch(/next week/i);
    expect(escalateCopy('catalog_miss').line.length).toBeGreaterThan(0);
    expect(escalateCopy('add_dish').declineLabel).toMatch(/not now/i);
  });
});

describe('resultCopy', () => {
  it('acknowledges a commit', () => {
    expect(resultCopy({ status: 'acknowledged', action: 'commit', confirmed_at: 'x' })).toMatch(/confirmed/i);
  });

  it('reports safety_write fixes when present', () => {
    const line = resultCopy({
      status: 'applied',
      action: 'safety_write',
      allergen: 'peanut',
      inserted: true,
      fixed_slots: [{ slot: undefined }, { slot: undefined }],
    });
    expect(line).toMatch(/2 dishes/);
  });

  it('notes a clean week when safety_write fixed nothing', () => {
    const line = resultCopy({
      status: 'applied',
      action: 'safety_write',
      allergen: 'peanut',
      inserted: true,
    });
    expect(line).toMatch(/already clear/i);
  });

  it('includes the day label for a main swap', () => {
    const line = resultCopy(
      { status: 'applied', action: 'swap_main', main_assignment: undefined },
      'Tuesday',
    );
    expect(line).toMatch(/Tuesday/);
  });
});
