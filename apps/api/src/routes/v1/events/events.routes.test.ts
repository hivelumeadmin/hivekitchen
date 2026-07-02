import { describe, it, expect, vi } from 'vitest';
import { replayMissedEvents } from './events.routes.js';

describe('replayMissedEvents (Last-Event-ID replay, 13-s2.5)', () => {
  it('reads the household stream strictly after the last id and writes frames in order', async () => {
    const entries: [string, string[]][] = [
      ['1700000000000-1', ['event', 'message', 'data', '{"type":"plan.progress","stage":"composing"}']],
      ['1700000000000-2', ['event', 'message', 'data', '{"type":"plan.updated"}']],
      ['1700000000000-3', ['event', 'lumi.nudge', 'data', '{"type":"lumi.nudge"}']],
    ];
    const xrange = vi.fn().mockResolvedValue(entries);
    const written: string[] = [];

    await replayMissedEvents({ xrange }, 'hh-1', '1700000000000-0', (f) => written.push(f));

    // Exclusive start `(id`, open end `+`, bounded by COUNT cap.
    expect(xrange).toHaveBeenCalledWith('sse:stream:household:hh-1', '(1700000000000-0', '+', 'COUNT', 200);
    expect(written).toEqual([
      'id: 1700000000000-1\nevent: message\ndata: {"type":"plan.progress","stage":"composing"}\n\n',
      'id: 1700000000000-2\nevent: message\ndata: {"type":"plan.updated"}\n\n',
      'id: 1700000000000-3\nevent: lumi.nudge\ndata: {"type":"lumi.nudge"}\n\n',
    ]);
  });

  it('writes nothing when there are no missed entries', async () => {
    const xrange = vi.fn().mockResolvedValue([]);
    const written: string[] = [];

    await replayMissedEvents({ xrange }, 'hh-1', '1700000000000-9', (f) => written.push(f));

    expect(written).toEqual([]);
  });

  it('propagates xrange errors so the caller can fall through to live-only', async () => {
    const xrange = vi.fn().mockRejectedValue(new Error('Redis connection lost'));

    await expect(
      replayMissedEvents({ xrange }, 'hh-1', '1700000000000-0', () => {}),
    ).rejects.toThrow('Redis connection lost');
  });

  it('respects a closed write channel — skips frames after the first write', async () => {
    const entries: [string, string[]][] = [
      ['1700000000000-1', ['event', 'message', 'data', '{"type":"plan.updated"}']],
      ['1700000000000-2', ['event', 'message', 'data', '{"type":"plan.progress","stage":"ready"}']],
    ];
    const xrange = vi.fn().mockResolvedValue(entries);
    const written: string[] = [];

    // Simulate the writableEnded guard: caller stops writing after the first frame.
    let closed = false;
    await replayMissedEvents({ xrange }, 'hh-1', '1700000000000-0', (frame) => {
      if (!closed) {
        written.push(frame);
        closed = true;
      }
    });

    expect(written).toHaveLength(1);
    expect(written[0]).toContain('plan.updated');
  });
});
