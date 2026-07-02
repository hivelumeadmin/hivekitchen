import { describe, it, expect, beforeEach } from 'vitest';
import { usePlanProgressStore, planProgressLabel } from './plan-progress.store.js';

const WEEK_ID = '00000000-0000-4000-8000-000000000001';

describe('usePlanProgressStore', () => {
  beforeEach(() => {
    usePlanProgressStore.getState().reset();
  });

  it('starts with no stage', () => {
    expect(usePlanProgressStore.getState().stage).toBeNull();
    expect(usePlanProgressStore.getState().weekId).toBeNull();
  });

  it('setProgress records the latest stage + week_id', () => {
    usePlanProgressStore.getState().setProgress(WEEK_ID, 'guardrail');
    expect(usePlanProgressStore.getState().stage).toBe('guardrail');
    expect(usePlanProgressStore.getState().weekId).toBe(WEEK_ID);
  });

  it('setProgress overwrites with the newest stage (one plan at a time)', () => {
    usePlanProgressStore.getState().setProgress(WEEK_ID, 'composing');
    usePlanProgressStore.getState().setProgress(WEEK_ID, 'ready');
    expect(usePlanProgressStore.getState().stage).toBe('ready');
  });

  it('reset clears stage + week_id', () => {
    usePlanProgressStore.getState().setProgress(WEEK_ID, 'persisting');
    usePlanProgressStore.getState().reset();
    expect(usePlanProgressStore.getState().stage).toBeNull();
    expect(usePlanProgressStore.getState().weekId).toBeNull();
  });
});

describe('planProgressLabel', () => {
  it('returns working-stage copy for in-flight stages', () => {
    expect(planProgressLabel('queued')).toMatch(/getting started/i);
    expect(planProgressLabel('composing')).toMatch(/composing/i);
    expect(planProgressLabel('guardrail')).toMatch(/allergen/i);
    expect(planProgressLabel('persisting')).toMatch(/saving/i);
  });

  it('returns null for terminal + absent stages (surrounding UI handles them)', () => {
    expect(planProgressLabel('ready')).toBeNull();
    expect(planProgressLabel('failed')).toBeNull();
    expect(planProgressLabel(null)).toBeNull();
  });
});
