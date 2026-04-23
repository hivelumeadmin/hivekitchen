#!/usr/bin/env tsx
import { readFileSync, readdirSync, globSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
const CONTRACTS_SRC = resolve(import.meta.dirname, '../src');

// Step 1: gather exported names from contracts/src/*.ts (not tests, not index)
const exportedNames = new Map<string, string>(); // name → file
for (const file of readdirSync(CONTRACTS_SRC)) {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'index.ts') continue;
  const content = readFileSync(join(CONTRACTS_SRC, file), 'utf8');
  for (const match of content.matchAll(/export const (\w+)\s*=/g)) {
    exportedNames.set(match[1], file);
  }
}

// Step 2: gather all imports from downstream consumers
const consumerFiles = [
  ...globSync('packages/types/src/**/*.ts', { cwd: ROOT }),
  ...globSync('apps/api/src/**/*.ts', { cwd: ROOT }),
  ...globSync('apps/web/src/**/*.ts', { cwd: ROOT }),
].map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');

// Step 3: check each export
const violations: string[] = [];
for (const [name, file] of exportedNames) {
  const isImported = new RegExp(`\\b${name}\\b`).test(consumerFiles);
  const srcContent = readFileSync(join(CONTRACTS_SRC, file), 'utf8');
  const isTagged = srcContent.includes('@unused-by-design');
  if (!isImported && !isTagged) violations.push(`${file}: ${name} is not imported by any downstream module`);
}

if (violations.length > 0) {
  process.stderr.write(`contracts:check FAILED:\n${violations.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`contracts:check PASSED: ${exportedNames.size} exports verified.\n`);
