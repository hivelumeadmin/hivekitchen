#!/usr/bin/env tsx
// contracts:check — verify every exported schema in packages/contracts is reachable
// from real downstream code.
//
// A schema is considered "used" if any of:
//   (a) it is imported by apps/api or apps/web (including .tsx) from either
//       '@hivekitchen/contracts' or '@hivekitchen/types';
//   (b) it is plumbed through packages/types/src/index.ts via a
//       `z.infer<typeof NAME>` site (verifies the plumbing chain is actually wired,
//       not just that the name appears somewhere in the barrel file);
//   (c) it is explicitly tagged `@unused-by-design` in its source file.
//
// Failure modes the previous substring-based check missed:
//   - false positives from bare-word regex across concatenated file text
//     (matched names inside comments, string literals, shadowed local variables);
//   - missed apps/web/**/*.tsx entirely (most React files);
//   - considered any appearance of the name in packages/types as usage, which is
//     tautological since packages/types mirrors every export 1:1 by design;
//   - only detected `export const` — any `export function` / `export type` /
//     `export { ... }` would silently escape.

import { readFileSync, readdirSync, globSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
const CONTRACTS_SRC = resolve(import.meta.dirname, '../src');
const TYPES_INDEX = resolve(ROOT, 'packages/types/src/index.ts');

// Step 1: enumerate exported names from contracts/src/*.ts.
const EXPORT_NAMED =
  /^\s*export\s+(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/gm;
const EXPORT_LIST = /^\s*export\s+(?:type\s+)?\{([^}]+)\}/gm;

const exportedNames = new Map<string, string>();
const duplicates: string[] = [];

for (const file of readdirSync(CONTRACTS_SRC)) {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'index.ts') continue;
  const content = readFileSync(join(CONTRACTS_SRC, file), 'utf8');

  const names = new Set<string>();
  for (const m of content.matchAll(EXPORT_NAMED)) names.add(m[1]);
  for (const m of content.matchAll(EXPORT_LIST)) {
    for (const raw of m[1].split(',')) {
      const aliased = raw.trim().split(/\s+as\s+/);
      const name = aliased[aliased.length - 1].replace(/^type\s+/, '').trim();
      if (name) names.add(name);
    }
  }

  for (const name of names) {
    const prior = exportedNames.get(name);
    if (prior && prior !== file) duplicates.push(`${name} in ${file} collides with ${prior}`);
    exportedNames.set(name, file);
  }
}

// Step 2: collect names imported by apps/api or apps/web (including .tsx).
// Restricted to import-statement syntax, so names inside comments/strings don't match.
const CONSUMER_GLOBS = [
  'apps/api/src/**/*.ts',
  'apps/api/src/**/*.tsx',
  'apps/web/src/**/*.ts',
  'apps/web/src/**/*.tsx',
];
const IMPORT_PATTERN =
  /import\s+(?:type\s+)?(?:\{([^}]+)\}|\*\s+as\s+\w+)\s+from\s+['"]@hivekitchen\/(?:contracts|types)['"]/g;

const appImported = new Set<string>();
for (const pattern of CONSUMER_GLOBS) {
  for (const relPath of globSync(pattern, { cwd: ROOT })) {
    const content = readFileSync(join(ROOT, relPath), 'utf8');
    for (const m of content.matchAll(IMPORT_PATTERN)) {
      if (!m[1]) continue; // star import — conservatively skip (no named usage signal)
      for (const raw of m[1].split(',')) {
        const parts = raw.trim().split(/\s+as\s+/);
        const name = parts[0].replace(/^type\s+/, '').trim();
        if (name) appImported.add(name);
      }
    }
  }
}

// Step 3: verify the packages/types plumbing chain — a name only counts if it
// appears in a `z.infer<typeof NAME>` site, not merely as a string in the file.
const typesContent = readFileSync(TYPES_INDEX, 'utf8');
const typesPlumbed = new Set<string>();
for (const m of typesContent.matchAll(/z\.infer\s*<\s*typeof\s+(\w+)\s*>/g)) {
  typesPlumbed.add(m[1]);
}

// Step 4: verify each export.
const violations: string[] = [];
for (const [name, file] of exportedNames) {
  if (appImported.has(name) || typesPlumbed.has(name)) continue;
  const srcContent = readFileSync(join(CONTRACTS_SRC, file), 'utf8');
  if (srcContent.includes('@unused-by-design')) continue;
  violations.push(
    `${file}: ${name} is not imported by apps/api or apps/web and is not plumbed via z.infer<> in packages/types`
  );
}

if (duplicates.length > 0) {
  process.stderr.write(`contracts:check FAILED — duplicate export names:\n${duplicates.join('\n')}\n`);
  process.exit(1);
}
if (violations.length > 0) {
  process.stderr.write(`contracts:check FAILED:\n${violations.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`contracts:check PASSED: ${exportedNames.size} exports verified.\n`);
