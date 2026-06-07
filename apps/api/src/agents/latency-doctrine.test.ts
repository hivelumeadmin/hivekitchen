import { describe, it, expect } from 'vitest';

import { classifyLatency, EARLY_ACK_COPY } from './latency-doctrine.js';

describe('classifyLatency', () => {
  it('returns sync at the base overhead with no tools', () => {
    const decision = classifyLatency([]);

    expect(decision.estimatedMs).toBe(1000);
    expect(decision.mode).toBe('sync');
    expect(decision.expectedWithinMs).toBe(1000);
  });

  it('returns early-ack when a single high-latency tool pushes past the sync ceiling', () => {
    // recipe.discover is 8000ms in TOOL_MANIFEST → 1000 base + 8000 = 9000ms.
    const decision = classifyLatency(['recipe.discover']);

    expect(decision.estimatedMs).toBe(9000);
    expect(decision.mode).toBe('early-ack');
    expect(decision.expectedWithinMs).toBe(9000);
  });

  it('returns thinking-pulse when the estimate lands in the [1500,4000] band', () => {
    // plan.compose is 2000ms → 1000 base + 2000 = 3000ms (inside the pulse band).
    const decision = classifyLatency(['plan.compose']);

    expect(decision.estimatedMs).toBe(3000);
    expect(decision.mode).toBe('thinking-pulse');
  });

  it('returns sync when the estimate is above the thinking-pulse ceiling but within the sync ceiling', () => {
    // Two plan.compose calls → 1000 base + 2000 + 2000 = 5000ms.
    // 5000 > THINKING_PULSE_CEIL_MS (4000) and ≤ SYNC_CEILING_MS (6000) → sync.
    const decision = classifyLatency(['plan.compose', 'plan.compose']);

    expect(decision.estimatedMs).toBe(5000);
    expect(decision.mode).toBe('sync');
  });

  it('throws on an unknown tool name (the manifest is the source of truth)', () => {
    expect(() => classifyLatency(['nonexistent.tool'])).toThrow(/no maxLatencyMs declaration/);
  });

  it('exposes the single sanctioned acknowledgement copy', () => {
    expect(EARLY_ACK_COPY).toBe('one sec.');
  });
});
