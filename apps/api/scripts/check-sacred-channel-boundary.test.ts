import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findViolations } from './check-sacred-channel-boundary.js';

describe('check-sacred-channel-boundary', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sacred-channel-test-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns no violations when no file calls both findForDelivery and orchestrator.complete', async () => {
    const sub = join(dir, 'case-clean');
    await mkdir(sub, { recursive: true });
    await writeFile(
      join(sub, 'delivery.ts'),
      `export async function deliver() {\n  await repo.findForDelivery(a, b, c);\n}\n`,
      'utf-8',
    );
    await writeFile(
      join(sub, 'agent.ts'),
      `export async function think() {\n  await orchestrator.complete({});\n}\n`,
      'utf-8',
    );

    const violations = await findViolations(sub);
    expect(violations).toEqual([]);
  });

  it('flags a file that calls BOTH findForDelivery and orchestrator.complete', async () => {
    const sub = join(dir, 'case-violation');
    await mkdir(sub, { recursive: true });
    await writeFile(
      join(sub, 'bad.ts'),
      `export async function bad() {\n  const note = await repo.findForDelivery(a, b, c);\n  await orchestrator.complete({ note });\n}\n`,
      'utf-8',
    );

    const violations = await findViolations(sub);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('bad.ts');
  });

  it('matches this.orchestrator.complete in a class context', async () => {
    const sub = join(dir, 'case-class');
    await mkdir(sub, { recursive: true });
    await writeFile(
      join(sub, 'klass.ts'),
      `class C {\n  async run() {\n    await this.repo.findForDelivery(a, b, c);\n    await this.orchestrator.complete({});\n  }\n}\n`,
      'utf-8',
    );

    const violations = await findViolations(sub);
    expect(violations).toHaveLength(1);
  });

  it('ignores *.test.ts files', async () => {
    const sub = join(dir, 'case-skip-test');
    await mkdir(sub, { recursive: true });
    await writeFile(
      join(sub, 'foo.test.ts'),
      `it('demo', async () => {\n  await repo.findForDelivery(a, b, c);\n  await orchestrator.complete({});\n});\n`,
      'utf-8',
    );

    const violations = await findViolations(sub);
    expect(violations).toEqual([]);
  });
});
