import { TOOL_MANIFEST } from './tools.manifest.js';

// §3.5 fixed budget overhead: 200ms thread load + 300ms intent classification
// + 500ms audit/persist. Tool estimates are summed on top of this base.
const LATENCY_BASE_OVERHEAD_MS = 1000;
const SYNC_CEILING_MS = 6000; // ≤ this → answer in one turn
const THINKING_PULSE_FLOOR_MS = 1500; // ≥ this (and ≤ ceiling) → non-verbal pulse
const THINKING_PULSE_CEIL_MS = 4000;

// The ONE sanctioned waiting phrase (AR-14 / §3.5, Sally's amendment).
// Every other waiting phrase is blocked by hivekitchen/no-assistant-filler.
export const EARLY_ACK_COPY = 'one sec.';

type LatencyMode = 'sync' | 'thinking-pulse' | 'early-ack';

export interface LatencyDecision {
  estimatedMs: number;
  mode: LatencyMode;
  expectedWithinMs: number; // === estimatedMs; carried for the early-ack continuation contract
}

export function classifyLatency(toolNames: readonly string[]): LatencyDecision {
  let estimatedMs = LATENCY_BASE_OVERHEAD_MS;
  for (const name of toolNames) {
    const spec = TOOL_MANIFEST.get(name);
    if (!spec) {
      throw new Error(
        `classifyLatency: tool "${name}" has no maxLatencyMs declaration in TOOL_MANIFEST (§3.5: declarations are the contract)`,
      );
    }
    estimatedMs += spec.maxLatencyMs;
  }

  let mode: LatencyMode;
  if (estimatedMs > SYNC_CEILING_MS) {
    mode = 'early-ack';
  } else if (estimatedMs >= THINKING_PULSE_FLOOR_MS && estimatedMs <= THINKING_PULSE_CEIL_MS) {
    mode = 'thinking-pulse';
  } else {
    mode = 'sync';
  }

  return { estimatedMs, mode, expectedWithinMs: estimatedMs };
}
