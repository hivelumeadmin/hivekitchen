import { parseEnv } from './common/env.js';
import { buildApp } from './app.js';
import { initOtel } from './observability/otel.js';
import type { FastifyInstance } from 'fastify';

const env = parseEnv(); // exits 1 on invalid env — no recovery

let app: FastifyInstance | undefined;

try {
  // OTEL must start BEFORE Fastify is imported/instantiated for auto-instrumentation
  // to patch module imports correctly. buildApp() instantiates Fastify.
  initOtel(env);

  app = await buildApp({ env });

  // Register signal handlers after app is built but before listen so no SIGTERM
  // can arrive in the window between listen completing and handlers being registered.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void (async () => {
        try {
          await app!.close();
          process.exit(0);
        } catch (err) {
          app!.log.error({ err }, 'graceful shutdown failed');
          process.exit(1);
        }
      })();
    });
  }

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  if (app) {
    app.log.error({ err }, 'startup failed');
    try {
      await app.close();
    } catch (closeErr) {
      app.log.error({ err: closeErr }, 'app.close() failed during startup error handling');
    }
  } else {
    process.stderr.write(
      JSON.stringify({
        level: 60,
        msg: `buildApp() failed — ${err instanceof Error ? err.message : String(err)}`,
        time: Date.now(),
      }) + '\n',
    );
  }
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  app?.log.fatal({ err: reason }, 'unhandledRejection — exiting');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  app?.log.fatal({ err }, 'uncaughtException — exiting');
  process.exit(1);
});
