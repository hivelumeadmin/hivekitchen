#!/usr/bin/env tsx
/**
 * Sacred-channel boundary check (Story 4-S5).
 *
 * Fails if any TypeScript file under apps/api/src/ both:
 *   (a) calls the sacred-channel delivery read path: .findForDelivery(
 *   (b) calls the LLM orchestrator: orchestrator.complete(
 *
 * The Heart Note delivery path must NEVER route through the LLM (PRD FR38, FR39).
 *
 * Limitation: same-file co-location only. Cross-file call-graph analysis is
 * deferred to slice 4-S18 (a more sophisticated absence-nudge lint rule).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DELIVERY_PATTERN = /\.findForDelivery\s*\(/;
const LLM_PATTERNS = [
  /\borchestrator\.complete\s*\(/,
  /this\.orchestrator\.complete\s*\(/,
  /fastify\.orchestrator\.complete\s*\(/,
];

export async function getTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts'))
    .map((e) => join((e as { parentPath?: string; path: string }).parentPath ?? e.path, e.name));
}

export async function findViolations(dir: string): Promise<string[]> {
  const files = await getTypeScriptFiles(dir);
  const violations: string[] = [];
  for (const file of files) {
    const src = await readFile(file, 'utf-8');
    if (!DELIVERY_PATTERN.test(src)) continue;
    const hasLlmCall = LLM_PATTERNS.some((p) => p.test(src));
    if (hasLlmCall) violations.push(file);
  }
  return violations;
}

export async function main(srcDir: string): Promise<number> {
  const violations = await findViolations(srcDir);
  const filesCount = (await getTypeScriptFiles(srcDir)).length;

  if (violations.length > 0) {
    // eslint-disable-next-line no-console
    console.error('Sacred-channel boundary violation (FR38/FR39):');
    // eslint-disable-next-line no-console
    console.error('The following files call both findForDelivery and the LLM orchestrator.');
    // eslint-disable-next-line no-console
    console.error('Heart Note delivery must NEVER route through AI. Remove the LLM call.');
    for (const f of violations) {
      // eslint-disable-next-line no-console
      console.error(`  X ${f}`);
    }
    return 1;
  }

  // eslint-disable-next-line no-console
  console.log(`Sacred-channel check: OK (${filesCount} files scanned, 0 violations)`);
  return 0;
}

const entryUrl = pathToFileURL(process.argv[1] ?? '').href;
if (import.meta.url === entryUrl) {
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));
  main(srcDir)
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('check-sacred-channel-boundary: unexpected error:', err);
      process.exit(1);
    });
}
