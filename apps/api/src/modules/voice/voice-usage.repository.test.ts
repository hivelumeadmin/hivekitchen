import { describe, expect, it, vi } from 'vitest';
import { VoiceUsageRepository } from './voice-usage.repository.js';

const SAMPLE_USER_ID = '00000000-0000-4000-8000-000000000001';
const WEEK_START = '2026-10-19'; // a Monday

function buildClient(overrides: Record<string, unknown> = {}) {
  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
}

describe('VoiceUsageRepository.getWeeklyUsage', () => {
  it('returns 0 when no row exists', async () => {
    const client = buildClient();
    const repo = new VoiceUsageRepository(client as never);

    const result = await repo.getWeeklyUsage(SAMPLE_USER_ID, WEEK_START);

    expect(result).toBe(0);
  });

  it('returns ms_consumed from an existing row', async () => {
    const client = buildClient({
      maybeSingle: vi.fn().mockResolvedValue({ data: { ms_consumed: 300_000 }, error: null }),
    });
    const repo = new VoiceUsageRepository(client as never);

    const result = await repo.getWeeklyUsage(SAMPLE_USER_ID, WEEK_START);

    expect(result).toBe(300_000);
  });

  it('throws on a DB error', async () => {
    const client = buildClient({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error('db error') }),
    });
    const repo = new VoiceUsageRepository(client as never);

    await expect(repo.getWeeklyUsage(SAMPLE_USER_ID, WEEK_START)).rejects.toThrow('db error');
  });
});

describe('VoiceUsageRepository.incrementUsage', () => {
  it('calls increment_voice_usage RPC with the correct args', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const repo = new VoiceUsageRepository({ rpc: rpcMock } as never);

    await repo.incrementUsage(SAMPLE_USER_ID, WEEK_START, 5_000);

    expect(rpcMock).toHaveBeenCalledWith('increment_voice_usage', {
      p_user_id: SAMPLE_USER_ID,
      p_week_start: WEEK_START,
      p_duration_ms: 5_000,
    });
  });

  it('throws on an RPC error', async () => {
    const repo = new VoiceUsageRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: new Error('rpc error') }),
    } as never);

    await expect(repo.incrementUsage(SAMPLE_USER_ID, WEEK_START, 5_000)).rejects.toThrow(
      'rpc error',
    );
  });
});
