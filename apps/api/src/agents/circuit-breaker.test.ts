import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

const FAILURE_THRESHOLD = 3;
const WINDOW_MS = 1_000;
const RECOVERY_MS = 60_000;

function buildBreaker(overrides: Partial<{ onOpen: () => void; onRecovered: () => void }> = {}) {
  const onOpen = overrides.onOpen ?? vi.fn();
  const onRecovered = overrides.onRecovered ?? vi.fn();
  const breaker = new CircuitBreaker({
    failureThreshold: FAILURE_THRESHOLD,
    windowMs: WINDOW_MS,
    recoveryMs: RECOVERY_MS,
    onOpen,
    onRecovered,
  });
  return { breaker, onOpen, onRecovered };
}

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays closed when failures are below the threshold', () => {
    const { breaker, onOpen } = buildBreaker();

    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.isTripped()).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens and calls onOpen when failures reach the threshold within the window', () => {
    const { breaker, onOpen } = buildBreaker();

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure();

    expect(breaker.isTripped()).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    breaker.dispose();
  });

  it('prunes failures older than the window so they do not count toward the threshold', () => {
    const { breaker, onOpen } = buildBreaker();

    breaker.recordFailure();
    breaker.recordFailure();

    vi.advanceTimersByTime(WINDOW_MS + 1);

    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.isTripped()).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('resets and stays closed when recordSuccess fires before opening', () => {
    const { breaker, onOpen, onRecovered } = buildBreaker();

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();

    expect(breaker.isTripped()).toBe(false);
    // recordSuccess only invokes onRecovered when the breaker was open;
    // a not-yet-open breaker should leave onRecovered untouched.
    expect(onRecovered).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('closes the circuit when recordSuccess fires while open, but defers onRecovered to the recovery timer', () => {
    const onRecovered = vi.fn();
    const { breaker } = buildBreaker({ onRecovered });

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure();
    expect(breaker.isTripped()).toBe(true);

    breaker.recordSuccess();

    expect(breaker.isTripped()).toBe(false);
    expect(onRecovered).not.toHaveBeenCalled();

    vi.advanceTimersByTime(RECOVERY_MS);
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it('fires onRecovered when the recovery timeout elapses', () => {
    const onRecovered = vi.fn();
    const { breaker } = buildBreaker({ onRecovered });

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure();
    expect(breaker.isTripped()).toBe(true);
    expect(onRecovered).not.toHaveBeenCalled();

    vi.advanceTimersByTime(RECOVERY_MS);

    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(breaker.isTripped()).toBe(false);
  });
});
