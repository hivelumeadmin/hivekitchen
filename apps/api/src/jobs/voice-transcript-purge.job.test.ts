import { describe, it, expect, vi } from 'vitest';
import { runVoiceTranscriptPurge } from './voice-transcript-purge.job.js';

describe('runVoiceTranscriptPurge', () => {
  it('deletes expired transcripts and returns count', async () => {
    const repo = { deleteExpired: vi.fn().mockResolvedValue({ count: 3 }) };
    const logger = { info: vi.fn(), error: vi.fn() };

    const result = await runVoiceTranscriptPurge({ repo, logger } as never);

    expect(result.count).toBe(3);
    expect(repo.deleteExpired).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it('re-throws on delete failure (BullMQ retry)', async () => {
    const repo = { deleteExpired: vi.fn().mockRejectedValue(new Error('DB error')) };
    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(runVoiceTranscriptPurge({ repo, logger } as never)).rejects.toThrow('DB error');
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
