import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResilientProvider, MAX_RATE_LIMIT_RETRIES } from './resilience.js';
import type { ResilienceOptions } from './resilience.js';
import type { LLMProvider, LLMResponse } from './llm-provider.interface.js';

// ===========================================================================
// Story 3.5-s7 — ResilientProvider unit tests.
// The 429 retry loop, circuit-breaker failover, and recovery race-guard were
// extracted verbatim from DomainOrchestrator. These tests pin that behavior in
// isolation, with vi.fn() provider stubs (no network) and fake timers for the
// wait-duration assertions.
// ===========================================================================

function okResponse(content = 'ok'): LLMResponse {
  return {
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
  };
}

function makeProvider(name: string, strict = true): LLMProvider {
  return {
    name,
    complete: vi.fn().mockResolvedValue(okResponse(`from-${name}`)),
    completeWithMessages: vi.fn().mockResolvedValue(okResponse(`from-${name}`)),
    stream: vi.fn(),
    probe: vi.fn().mockResolvedValue(true),
    supportsStrictTools: vi.fn().mockReturnValue(strict),
  } as unknown as LLMProvider;
}

function rateLimitError(resetTokensHeader?: string): { status: number; headers?: Record<string, string> } {
  return {
    status: 429,
    ...(resetTokensHeader ? { headers: { 'x-ratelimit-reset-tokens': resetTokensHeader } } : {}),
  };
}

function makeOptions(overrides: Partial<ResilienceOptions> = {}): ResilienceOptions {
  return {
    failureThreshold: 5,
    windowMs: 60_000,
    recoveryMs: 900_000,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    onFailover: vi.fn(),
    onRecovered: vi.fn(),
    ...overrides,
  };
}

describe('ResilientProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when constructed with no providers', () => {
    expect(() => new ResilientProvider([], makeOptions())).toThrow(
      'ResilientProvider requires at least one LLMProvider',
    );
  });

  // ---- 429 retry loop --------------------------------------------------------

  it('"54.726s" header → waits 55726ms then retries (case 1)', async () => {
    const provider = makeProvider('primary');
    (provider.completeWithMessages as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(rateLimitError('54.726s'))
      .mockResolvedValueOnce(okResponse('recovered'));
    const resilient = new ResilientProvider([provider], makeOptions());

    const p = resilient.completeWithMessages([], [], { tier: 'flagship' });
    await vi.advanceTimersByTimeAsync(55_726);
    const result = await p;

    expect(provider.completeWithMessages).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('recovered');
  });

  it('"1m21.587s" header → waits 82587ms then retries (case 2)', async () => {
    const provider = makeProvider('primary');
    (provider.completeWithMessages as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(rateLimitError('1m21.587s'))
      .mockResolvedValueOnce(okResponse());
    const resilient = new ResilientProvider([provider], makeOptions());

    const p = resilient.completeWithMessages([], [], { tier: 'flagship' });
    // Not yet enough time elapsed — still on the first (rejected) attempt.
    await vi.advanceTimersByTimeAsync(82_586);
    expect(provider.completeWithMessages).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await p;

    expect(provider.completeWithMessages).toHaveBeenCalledTimes(2);
  });

  it('no header → waits the 90s default (91000ms) then retries (case 3)', async () => {
    const provider = makeProvider('primary');
    (provider.completeWithMessages as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce(okResponse());
    const resilient = new ResilientProvider([provider], makeOptions());

    const p = resilient.completeWithMessages([], [], { tier: 'flagship' });
    await vi.advanceTimersByTimeAsync(91_000);
    await p;

    expect(provider.completeWithMessages).toHaveBeenCalledTimes(2);
  });

  it('non-429 error → does NOT retry, propagates immediately, counts as a CB failure (case 4)', async () => {
    const provider = makeProvider('primary');
    const fallback = makeProvider('fallback');
    (provider.completeWithMessages as ReturnType<typeof vi.fn>).mockRejectedValue({ status: 500 });
    const options = makeOptions();
    const resilient = new ResilientProvider([provider, fallback], options);

    // Each call is a single failure (no retry). 5 → trips the breaker → failover.
    for (let i = 0; i < 5; i++) {
      const err = await resilient.completeWithMessages([], [], {}).catch((e: unknown) => e);
      expect(err).toMatchObject({ status: 500 });
    }

    // 5 attempts, one per call — proves no retry on non-429.
    expect(provider.completeWithMessages).toHaveBeenCalledTimes(5);
    expect(options.onFailover).toHaveBeenCalledTimes(1);
    expect(options.onFailover).toHaveBeenCalledWith('primary', 'fallback', expect.any(String));
    resilient.dispose();
  });

  it(`retries ${String(MAX_RATE_LIMIT_RETRIES)}× on persistent 429 then propagates (case 5)`, async () => {
    const provider = makeProvider('primary');
    (provider.completeWithMessages as ReturnType<typeof vi.fn>).mockRejectedValue(
      rateLimitError('54.726s'),
    );
    const resilient = new ResilientProvider([provider], makeOptions());

    const p = resilient.completeWithMessages([], [], {}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(55_726 * (MAX_RATE_LIMIT_RETRIES + 1));
    const err = await p;

    expect(err).toMatchObject({ status: 429 });
    // attempts 0,1,2,3 → retried 3 times, the 4th throw propagates.
    expect(provider.completeWithMessages).toHaveBeenCalledTimes(MAX_RATE_LIMIT_RETRIES + 1);
  });

  // ---- circuit breaker / failover -------------------------------------------

  it('5 failures → onFailover fires with (from, to, reason) (case 6)', async () => {
    const primary = makeProvider('primary');
    const fallback = makeProvider('fallback');
    (primary.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    const options = makeOptions();
    const resilient = new ResilientProvider([primary, fallback], options);

    for (let i = 0; i < 5; i++) {
      await resilient.complete('hi', [], {}).catch(() => undefined);
    }

    expect(options.onFailover).toHaveBeenCalledTimes(1);
    expect(options.onFailover).toHaveBeenCalledWith('primary', 'fallback', expect.any(String));
    expect(resilient.getActiveProvider().name).toBe('fallback');
    resilient.dispose();
  });

  it('a success resets the failure count so the breaker does not trip (case 7)', async () => {
    const primary = makeProvider('primary');
    const fallback = makeProvider('fallback');
    const completeMock = primary.complete as ReturnType<typeof vi.fn>;
    completeMock
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(okResponse());
    const options = makeOptions();
    const resilient = new ResilientProvider([primary, fallback], options);

    for (let i = 0; i < 4; i++) {
      await resilient.complete('hi', [], {}).catch(() => undefined);
    }
    await resilient.complete('hi', [], {}); // success clears the window

    expect(options.onFailover).not.toHaveBeenCalled();
    expect(resilient.getStatus().circuit_open).toBe(false);
    expect(resilient.getActiveProvider().name).toBe('primary');
    resilient.dispose();
  });

  it('getStatus reflects active provider and circuit state before/after failover (case 8)', async () => {
    const primary = makeProvider('primary');
    const fallback = makeProvider('fallback');
    (primary.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    const resilient = new ResilientProvider([primary, fallback], makeOptions());

    expect(resilient.getStatus()).toEqual({
      active_provider: 'primary',
      circuit_open: false,
      providers: ['primary', 'fallback'],
    });

    for (let i = 0; i < 5; i++) {
      await resilient.complete('hi', [], {}).catch(() => undefined);
    }

    const status = resilient.getStatus();
    expect(status.active_provider).toBe('fallback');
    expect(status.circuit_open).toBe(true);
    resilient.dispose();
  });

  // ---- recovery probe race guard --------------------------------------------

  it('recovery attempt no-ops (does not probe) while still on the primary (case 9)', async () => {
    // Single provider: a tripped breaker has nowhere to fail over to, so the
    // active index stays 0. When the recovery timer fires, the
    // `currentProviderIndex === 0` guard must skip the primary probe.
    const primary = makeProvider('primary');
    (primary.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    const resilient = new ResilientProvider([primary], makeOptions());

    for (let i = 0; i < 5; i++) {
      await resilient.complete('hi', [], {}).catch(() => undefined);
    }
    (primary.probe as ReturnType<typeof vi.fn>).mockClear();

    await vi.advanceTimersByTimeAsync(900_000);

    expect(primary.probe).not.toHaveBeenCalled();
    resilient.dispose();
  });

  it('recovery probe success → resets to primary and calls onRecovered', async () => {
    const primary = makeProvider('primary');
    const fallback = makeProvider('fallback');
    (primary.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    (primary.probe as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const options = makeOptions();
    const resilient = new ResilientProvider([primary, fallback], options);

    for (let i = 0; i < 5; i++) {
      await resilient.complete('hi', [], {}).catch(() => undefined);
    }
    expect(resilient.getActiveProvider().name).toBe('fallback');

    await vi.advanceTimersByTimeAsync(900_000);

    expect(primary.probe).toHaveBeenCalled();
    expect(resilient.getActiveProvider().name).toBe('primary');
    expect(options.onRecovered).toHaveBeenCalledWith('fallback', 'primary');
    resilient.dispose();
  });

  // ---- delegation ------------------------------------------------------------

  it('supportsStrictTools delegates to the active provider (case 10)', async () => {
    const primary = makeProvider('primary', true);
    const fallback = makeProvider('fallback', false);
    (primary.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    const resilient = new ResilientProvider([primary, fallback], makeOptions());

    expect(resilient.supportsStrictTools()).toBe(true);

    for (let i = 0; i < 5; i++) {
      await resilient.complete('hi', [], {}).catch(() => undefined);
    }

    expect(resilient.supportsStrictTools()).toBe(false);
    resilient.dispose();
  });

  it('a 429 does NOT count toward the circuit breaker (case 11)', async () => {
    const primary = makeProvider('primary');
    const fallback = makeProvider('fallback');
    // 4 genuine (non-429) failures leave the breaker at 4/5 — one short of open.
    (primary.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    // A 429 that retries then succeeds. If the 429 wrongly recorded a failure it
    // would be the 5th → breaker opens → onFailover. It must not.
    (primary.completeWithMessages as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(rateLimitError('54.726s'))
      .mockResolvedValueOnce(okResponse());
    const options = makeOptions();
    const resilient = new ResilientProvider([primary, fallback], options);

    for (let i = 0; i < 4; i++) {
      await resilient.complete('hi', [], {}).catch(() => undefined);
    }

    const p = resilient.completeWithMessages([], [], {});
    await vi.advanceTimersByTimeAsync(55_726);
    await p;

    expect(options.onFailover).not.toHaveBeenCalled();
    expect(resilient.getStatus().circuit_open).toBe(false);
    expect(resilient.getActiveProvider().name).toBe('primary');
    resilient.dispose();
  });
});
