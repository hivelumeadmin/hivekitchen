// Fetch + self-host the per-script Noto woff2 subsets that back the Heart Note
// multilingual fallback (story 4-S16). Heart Note = editorial-serif register
// per DESIGN.md §13.7, so the serif chain gets Noto Serif per script and Noto
// Naskh Arabic for Arabic; the UI sans chain gets Noto Sans per script (Arabic
// reuses the single Naskh file).
//
// Run: node scripts/fetch-multilingual-fonts.mjs
//
// For each family we hit the Google Fonts css2 API with a modern browser
// User-Agent (so Google returns woff2, not ttf), pick the @font-face block for
// the target script subset, download its woff2 into apps/web/public/fonts/, and
// print the @font-face snippet (with the verbatim unicode-range) for pasting
// into packages/design-system/tokens/typography.css.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontsDir = resolve(__dirname, '../apps/web/public/fonts');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// `subset` is the Google css2 subset comment (/* devanagari */ …) we want.
const FAMILIES = [
  // Heart Note serif register
  { family: 'Noto Serif Devanagari', subset: 'devanagari', file: 'NotoSerifDevanagari.woff2' },
  { family: 'Noto Serif Bengali', subset: 'bengali', file: 'NotoSerifBengali.woff2' },
  { family: 'Noto Serif Hebrew', subset: 'hebrew', file: 'NotoSerifHebrew.woff2' },
  { family: 'Noto Serif Tamil', subset: 'tamil', file: 'NotoSerifTamil.woff2' },
  { family: 'Noto Naskh Arabic', subset: 'arabic', file: 'NotoNaskhArabic.woff2' },
  // UI sans register (Arabic reuses NotoNaskhArabic.woff2 — not fetched twice)
  { family: 'Noto Sans Devanagari', subset: 'devanagari', file: 'NotoSansDevanagari.woff2' },
  { family: 'Noto Sans Bengali', subset: 'bengali', file: 'NotoSansBengali.woff2' },
  { family: 'Noto Sans Hebrew', subset: 'hebrew', file: 'NotoSansHebrew.woff2' },
  { family: 'Noto Sans Tamil', subset: 'tamil', file: 'NotoSansTamil.woff2' },
];

function parseBlocks(css) {
  const BLOCK_RE = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([\s\S]*?)\}/g;
  const blocks = [];
  let m;
  while ((m = BLOCK_RE.exec(css)) !== null) {
    const subset = m[1];
    const body = m[2];
    const src = /src:\s*url\(([^)]+)\)/.exec(body)?.[1];
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
    if (src && unicodeRange) blocks.push({ subset, src, unicodeRange });
  }
  return blocks;
}

async function fetchCss(family) {
  const url = `https://fonts.googleapis.com/css2?family=${family.replaceAll(' ', '+')}&display=swap`;
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`css2 fetch failed for ${family}: ${res.status}`);
  return res.text();
}

async function downloadWoff2(src, destPath) {
  const res = await fetch(src, { headers: { 'User-Agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`woff2 fetch failed: ${src}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
  return buf.length;
}

async function main() {
  await mkdir(fontsDir, { recursive: true });
  const snippets = [];

  for (const { family, subset, file } of FAMILIES) {
    const css = await fetchCss(family);
    const blocks = parseBlocks(css);
    const block = blocks.find((b) => b.subset === subset);
    if (!block) {
      throw new Error(
        `No "${subset}" subset block for ${family}. Got: ${blocks.map((b) => b.subset).join(', ')}`,
      );
    }
    const destPath = resolve(fontsDir, file);
    const bytes = await downloadWoff2(block.src, destPath);
    console.log(`✓ ${file} (${(bytes / 1024).toFixed(1)} KB) — ${subset} subset of ${family}`);

    snippets.push(
      `@font-face {\n` +
        `  font-family: '${family}';\n` +
        `  src: url('/fonts/${file}') format('woff2');\n` +
        `  font-weight: 400;\n` +
        `  font-style: normal;\n` +
        `  font-display: swap;\n` +
        `  unicode-range: ${block.unicodeRange};\n` +
        `}`,
    );
  }

  console.log('\n/* ---- paste into packages/design-system/tokens/typography.css ---- */\n');
  console.log(snippets.join('\n\n'));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
