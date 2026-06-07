import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import Redis from 'ioredis';
import { sseDispatcherPlugin } from './sse-dispatcher.plugin.js';

// The dispatcher creates a DEDICATED subscriber connection via `new Redis(...)`.
// Mock ioredis so registration doesn't open a real socket and so the test can
// capture the subscriber's `message` handler to simulate inbound pub/sub.
interface FakeSubscriber {
  messageHandler: ((channel: string, payload: string) => void) | null;
  connect: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  on: (event: string, handler: (channel: string, payload: string) => void) => FakeSubscriber;
}

vi.mock('ioredis', () => {
  class FakeRedis {
    static instances: FakeSubscriber[] = [];
    messageHandler: ((channel: string, payload: string) => void) | null = null;
    connect = vi.fn().mockResolvedValue(undefined);
    subscribe = vi.fn().mockResolvedValue(undefined);
    unsubscribe = vi.fn().mockResolvedValue(undefined);
    quit = vi.fn().mockResolvedValue(undefined);
    on(event: string, handler: (channel: string, payload: string) => void): this {
      if (event === 'message') this.messageHandler = handler;
      return this;
    }
    constructor() {
      FakeRedis.instances.push(this as unknown as FakeSubscriber);
    }
  }
  return { default: FakeRedis };
});

const FakeRedis = Redis as unknown as { instances: FakeSubscriber[] };

function fakeRes(): ServerResponse & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    writableEnded: false,
    write: vi.fn((chunk: string) => {
      written.push(chunk);
      return true;
    }),
  } as unknown as ServerResponse & { written: string[] };
}

async function buildDispatcher(): Promise<{
  app: FastifyInstance;
  publish: ReturnType<typeof vi.fn>;
  subscriber: FakeSubscriber;
}> {
  const app = Fastify({ logger: false });
  app.decorate('env', { REDIS_URL: 'redis://localhost:6379' } as unknown as FastifyInstance['env']);
  const publish = vi.fn().mockResolvedValue(1);
  app.decorate('redis', { publish } as unknown as FastifyInstance['redis']);
  await app.register(sseDispatcherPlugin);
  const subscriber = FakeRedis.instances[FakeRedis.instances.length - 1]!;
  return { app, publish, subscriber };
}

beforeEach(() => {
  FakeRedis.instances.length = 0;
});

describe('sseDispatcher (Redis pub/sub)', () => {
  it('emit publishes a framed SSE payload on the household channel', async () => {
    const { app, publish } = await buildDispatcher();

    app.sseDispatcher.emit('hh-1', 'lumi.nudge', '{"hello":"world"}');

    expect(publish).toHaveBeenCalledWith(
      'sse:household:hh-1',
      'event: lumi.nudge\ndata: {"hello":"world"}\n\n',
    );
    await app.close();
  });

  it('register subscribes only on the first connection for a household', async () => {
    const { app, subscriber } = await buildDispatcher();

    app.sseDispatcher.register('hh-1', fakeRes());
    app.sseDispatcher.register('hh-1', fakeRes());

    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith('sse:household:hh-1');
    await app.close();
  });

  it('register subscribes once per distinct household', async () => {
    const { app, subscriber } = await buildDispatcher();

    app.sseDispatcher.register('hh-1', fakeRes());
    app.sseDispatcher.register('hh-2', fakeRes());

    expect(subscriber.subscribe).toHaveBeenCalledTimes(2);
    expect(subscriber.subscribe).toHaveBeenCalledWith('sse:household:hh-1');
    expect(subscriber.subscribe).toHaveBeenCalledWith('sse:household:hh-2');
    await app.close();
  });

  it('unregister unsubscribes only when the last connection is removed', async () => {
    const { app, subscriber } = await buildDispatcher();
    const a = fakeRes();
    const b = fakeRes();

    app.sseDispatcher.register('hh-1', a);
    app.sseDispatcher.register('hh-1', b);

    app.sseDispatcher.unregister('hh-1', a);
    expect(subscriber.unsubscribe).not.toHaveBeenCalled();

    app.sseDispatcher.unregister('hh-1', b);
    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.unsubscribe).toHaveBeenCalledWith('sse:household:hh-1');
    await app.close();
  });

  it('subscriber message handler writes the raw payload to local connections', async () => {
    const { app, subscriber } = await buildDispatcher();
    const res = fakeRes();

    app.sseDispatcher.register('hh-1', res);
    subscriber.messageHandler?.('sse:household:hh-1', 'event: x\ndata: y\n\n');

    expect(res.written).toEqual(['event: x\ndata: y\n\n']);
    await app.close();
  });

  it('subscriber message handler ignores households with no local connections', async () => {
    const { app, subscriber } = await buildDispatcher();

    expect(() =>
      subscriber.messageHandler?.('sse:household:nobody', 'event: x\ndata: y\n\n'),
    ).not.toThrow();
    await app.close();
  });
});
