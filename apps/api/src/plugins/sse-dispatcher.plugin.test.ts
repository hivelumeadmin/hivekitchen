import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { ServerResponse } from 'node:http';
import { sseDispatcherPlugin } from './sse-dispatcher.plugin.js';

async function buildDispatcher() {
  const app = Fastify();
  await app.register(sseDispatcherPlugin);
  return app;
}

function fakeRes(): ServerResponse & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write: vi.fn((chunk: string) => {
      written.push(chunk);
      return true;
    }),
  } as unknown as ServerResponse & { written: string[] };
}

describe('sseDispatcher', () => {
  it('emit writes a framed SSE payload to a registered connection', async () => {
    const app = await buildDispatcher();
    const res = fakeRes();

    app.sseDispatcher.register('hh-1', res);
    app.sseDispatcher.emit('hh-1', 'lumi.nudge', '{"hello":"world"}');

    expect(res.written).toEqual(['event: lumi.nudge\ndata: {"hello":"world"}\n\n']);
    await app.close();
  });

  it('emit fans out to every connection for the household', async () => {
    const app = await buildDispatcher();
    const a = fakeRes();
    const b = fakeRes();

    app.sseDispatcher.register('hh-1', a);
    app.sseDispatcher.register('hh-1', b);
    app.sseDispatcher.emit('hh-1', 'lumi.nudge', 'x');

    expect(a.written).toHaveLength(1);
    expect(b.written).toHaveLength(1);
    await app.close();
  });

  it('unregister removes the connection so it stops receiving events', async () => {
    const app = await buildDispatcher();
    const res = fakeRes();

    app.sseDispatcher.register('hh-1', res);
    app.sseDispatcher.unregister('hh-1', res);
    app.sseDispatcher.emit('hh-1', 'lumi.nudge', 'x');

    expect(res.written).toEqual([]);
    await app.close();
  });

  it('emit to an unknown household is a no-op', async () => {
    const app = await buildDispatcher();

    expect(() => app.sseDispatcher.emit('nobody', 'lumi.nudge', 'x')).not.toThrow();
    await app.close();
  });

  it('drops a connection whose write throws and keeps fanning out to the rest', async () => {
    const app = await buildDispatcher();
    const good = fakeRes();
    const broken = {
      write: vi.fn(() => {
        throw new Error('socket closed');
      }),
    } as unknown as ServerResponse;

    app.sseDispatcher.register('hh-1', broken);
    app.sseDispatcher.register('hh-1', good);
    app.sseDispatcher.emit('hh-1', 'lumi.nudge', 'x');

    expect(good.written).toHaveLength(1);
    await app.close();
  });
});
