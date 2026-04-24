import type { FastifyServerOptions } from 'fastify';
import type { Env } from './env.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.heart_note_content',
  '*.child_name',
  '*.declared_allergens',
  '*.cultural_identifiers',
  '*.dietary_preferences',
  '*.card',
  '*.cvv',
];

export function getLoggerOptions(env: Env): FastifyServerOptions['logger'] {
  const base: FastifyServerOptions['logger'] = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, remove: true },
  };

  if (env.NODE_ENV === 'development') {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };
  }

  return base;
}
