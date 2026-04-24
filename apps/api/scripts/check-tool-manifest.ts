import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOOL_MANIFEST } from '../src/agents/tools.manifest.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REQUIRED_FIELDS = [
  'name',
  'description',
  'inputSchema',
  'outputSchema',
  'maxLatencyMs',
  'fn',
] as const;

function extractManifestNames(mod: unknown): readonly string[] {
  if (
    typeof mod === 'object' &&
    mod !== null &&
    'MANIFESTED_TOOL_NAMES' in mod &&
    Array.isArray((mod as Record<string, unknown>).MANIFESTED_TOOL_NAMES)
  ) {
    return (mod as Record<string, readonly string[]>).MANIFESTED_TOOL_NAMES;
  }
  return [];
}

async function main(): Promise<void> {
  const toolsDir = resolve(SCRIPT_DIR, '../src/agents/tools');

  let toolFiles: string[];
  try {
    const entries = await readdir(toolsDir);
    toolFiles = entries.filter((f) => f.endsWith('.tools.ts'));
  } catch (err) {
    const isNoEnt =
      typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
    if (!isNoEnt) throw err;
    console.log('ℹ️  tools/ directory not found — nothing to cross-check');
    return;
  }

  if (toolFiles.length === 0) {
    console.log('✅ No *.tools.ts files found — manifest check skipped');
    return;
  }

  let violationCount = 0;

  for (const file of toolFiles) {
    const filePath = pathToFileURL(resolve(toolsDir, file)).href;
    const mod: unknown = await import(filePath);
    const manifestedNames = extractManifestNames(mod);

    if (manifestedNames.length === 0) {
      console.error(`❌ [${file}] No MANIFESTED_TOOL_NAMES export — every *.tools.ts file must declare what it provides`);
      violationCount++;
      continue;
    }

    for (const name of manifestedNames) {
      if (!TOOL_MANIFEST.has(name)) {
        console.error(
          `❌ [${file}] "${name}" not in TOOL_MANIFEST — register it in tools.manifest.ts before merging`,
        );
        violationCount++;
        continue;
      }

      const spec = TOOL_MANIFEST.get(name);
      for (const field of REQUIRED_FIELDS) {
        if (!spec || spec[field as keyof typeof spec] === undefined) {
          console.error(`❌ [${file}] Tool "${name}" missing manifest field: "${field}"`);
          violationCount++;
        }
      }
    }
  }

  if (violationCount > 0) {
    console.error(
      `\n🚫 ${violationCount} manifest violation(s). Every tool in *.tools.ts must be registered in tools.manifest.ts with all 6 required fields.`,
    );
    process.exit(1);
  }

  console.log(`✅ Tool manifest check passed (${toolFiles.length} tool file(s), 0 violations)`);
}

main().catch((err: unknown) => {
  console.error(
    'check-tool-manifest: unexpected error:',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
