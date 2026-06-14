import fp from 'fastify-plugin';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import { VoiceTranscriptRepository } from '../modules/voice/voice-transcript.repository.js';

const VOICE_TRANSCRIPT_PURGE_QUEUE = 'voice-transcript-purge';
const VOICE_TRANSCRIPT_PURGE_SCHEDULER_ID = 'nightly-voice-transcript-purge';

export interface VoiceTranscriptPurgeDeps {
  repo: Pick<VoiceTranscriptRepository, 'deleteExpired'>;
  logger: FastifyBaseLogger;
}

// 5-S15 — extracted for unit testability (mirrors runMemoryForgetSweep pattern).
// Deletes every voice_transcripts row whose retention_until is in the past.
// Re-throws on delete failure so the worker triggers a BullMQ retry (attempts: 3).
export async function runVoiceTranscriptPurge(
  deps: VoiceTranscriptPurgeDeps,
): Promise<{ count: number }> {
  let result: { count: number };
  try {
    result = await deps.repo.deleteExpired();
  } catch (err) {
    deps.logger.error(
      { err, module: 'voice-transcript-purge', action: 'purge.failed' },
      'voice-transcript-purge: delete query failed',
    );
    throw err; // BullMQ retries (attempts: 3)
  }

  deps.logger.info(
    { module: 'voice-transcript-purge', action: 'purge.complete', count: result.count },
    'voice-transcript-purge: deleted expired transcripts',
  );

  return result;
}

const voiceTranscriptPurgePlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error(
      'voiceTranscriptPurgePlugin requires supabase — register supabasePlugin first',
    );
  }

  const repo = new VoiceTranscriptRepository(fastify.supabase);
  const queue = fastify.bullmq.getQueue(VOICE_TRANSCRIPT_PURGE_QUEUE);

  void queue
    .upsertJobScheduler(
      VOICE_TRANSCRIPT_PURGE_SCHEDULER_ID,
      { pattern: '0 4 * * *', tz: 'UTC' },
      {
        name: 'purge-expired-transcripts',
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 60_000 },
          removeOnComplete: { count: 30 },
          removeOnFail: { count: 14 },
        },
      },
    )
    .catch((err: unknown) => {
      fastify.log.error(
        { err, module: 'voice-transcript-purge', action: 'scheduler.registration.failed' },
        'failed to register voice-transcript-purge scheduler',
      );
    });

  fastify.bullmq.getWorker(VOICE_TRANSCRIPT_PURGE_QUEUE, async () => {
    await runVoiceTranscriptPurge({ repo, logger: fastify.log });
  });
};

export const voiceTranscriptPurgeJobPlugin = fp(voiceTranscriptPurgePlugin, {
  name: 'voice-transcript-purge-job',
});
