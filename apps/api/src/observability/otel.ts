import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { Env } from '../common/env.js';

let sdk: NodeSDK | null = null;

export function initOtel(
  env: Pick<Env, 'NODE_ENV' | 'OTEL_EXPORTER_OTLP_ENDPOINT' | 'OTEL_EXPORTER_OTLP_HEADERS'>,
): void {
  if (sdk !== null) return;

  const isDev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

  const traceExporter = (
    isDev || !env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? new ConsoleSpanExporter()
      : new OTLPTraceExporter({
          url: env.OTEL_EXPORTER_OTLP_ENDPOINT,
          headers: parseOtelHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
        })
  ) as unknown as SpanExporter;

  sdk = new NodeSDK({
    resource: new Resource({
      'service.name': 'hivekitchen-api',
      'deployment.environment': env.NODE_ENV,
    }),
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export async function shutdownOtel(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

function parseOtelHeaders(headers: string | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(
    headers.split(',').flatMap((pair) => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) return [];
      return [[pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim()]];
    }),
  );
}
