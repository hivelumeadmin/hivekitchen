// apps/web/src/lib/realtime/thread-integrity.ts
//
// Stub call site for the thread-sequence-gap beacon.
// Full implementation: Story 5.17 (POST /v1/internal/client-anomaly with kind='thread_integrity').

export interface ThreadIntegrityAnomaly {
  thread_id: string;
  expected_seq: bigint;
  received_seq: bigint;
}

/**
 * Reports a thread sequence gap to the server anomaly endpoint.
 *
 * TODO(Story 5.17): Replace stub with real fetch to POST /v1/internal/client-anomaly
 * with body { kind: 'thread_integrity', thread_id, expected_seq: String(expected_seq),
 * received_seq: String(received_seq) }.
 * BigInt serialized as string because JSON.stringify does not serialize BigInt natively.
 */
export function reportThreadIntegrityAnomaly(anomaly: ThreadIntegrityAnomaly): void {
  // Story 5.17 will implement the actual beacon call.
  // For now, log in dev mode only — production is a no-op.
  if (import.meta.env.DEV) {
    console.warn('[thread-integrity] sequence gap detected', {
      thread_id: anomaly.thread_id,
      expected_seq: String(anomaly.expected_seq),
      received_seq: String(anomaly.received_seq),
    });
  }
}
