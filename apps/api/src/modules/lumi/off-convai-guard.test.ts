import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

// Story 5-S5b — grep guard. After migrating ambient Lumi voice off the
// ElevenLabs Conversational AI agent, NONE of these tokens may appear anywhere
// under apps/api/src or apps/web/src. The vendored `.agents/**` boilerplate is
// out of scope (it lives outside the src trees, so it is never scanned here).
const FORBIDDEN = [
  'get_signed_url',
  'agent_id',
  'ELEVENLABS_AGENT_ID',
  'user_transcript',
  'convai',
  'issueElevenLabsCredentials',
];

const THIS_FILE = fileURLToPath(import.meta.url);
const API_SRC = resolve(dirname(THIS_FILE), '..', '..'); // apps/api/src
const REPO_ROOT = resolve(API_SRC, '..', '..', '..'); // repo root
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');

const SCANNED_EXTENSIONS = ['.ts', '.tsx'];

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...collectFiles(full));
      continue;
    }
    if (!SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    // Exclude this guard file itself — it necessarily names the tokens.
    if (full === THIS_FILE) continue;
    out.push(full);
  }
  return out;
}

describe('off-ConvAI grep guard (Story 5-S5b)', () => {
  const files = [...collectFiles(API_SRC), ...collectFiles(WEB_SRC)];

  it('scans a non-trivial number of source files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const token of FORBIDDEN) {
    it(`no source file under apps/{api,web}/src contains "${token}"`, () => {
      const needle = token.toLowerCase();
      const hits = files.filter((f) =>
        readFileSync(f, 'utf8').toLowerCase().includes(needle),
      );
      expect(hits.map((f) => relative(REPO_ROOT, f))).toEqual([]);
    });
  }
});
