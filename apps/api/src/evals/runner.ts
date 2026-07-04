/**
 * OpenAI Evals API runner — thin CLI for creating and polling eval runs.
 *
 * Usage:
 *   npx tsx apps/api/src/evals/runner.ts <definition-file>
 *   npx tsx apps/api/src/evals/runner.ts definitions/planner-schema.eval.json
 *
 * The runner:
 *   1. Reads the eval definition JSON from the given path.
 *   2. Creates an eval via POST /v1/evals (or reuses an existing one by name).
 *   3. Creates a run against the stored-completions dataset.
 *   4. Polls until done, then prints per-criteria pass/fail and the aggregate score.
 *
 * Prerequisites:
 *   - OPENAI_API_KEY must be set.
 *   - OPENAI_STORE_COMPLETIONS=true must have been running in the target environment
 *     so that stored completions have accumulated for the agent_type/prompt_version
 *     being evaluated.
 */

// eslint-disable-next-line no-restricted-imports -- standalone CLI eval runner (tsx-invoked), not app runtime; talks to the OpenAI Evals API directly
import OpenAI from 'openai';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60; // 5 min max

interface EvalDefinition {
  name: string;
  data_source_config: {
    type: 'stored_completions';
    metadata: Record<string, string>;
  };
  testing_criteria: Array<{
    name: string;
    type: 'label_model' | 'score_model' | 'string_check' | 'python';
    [key: string]: unknown;
  }>;
}

async function main(): Promise<void> {
  const defPath = process.argv[2];
  if (!defPath) {
    process.stderr.write('Usage: runner.ts <definition-file>\n');
    process.exit(1);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    process.stderr.write('OPENAI_API_KEY is not set\n');
    process.exit(1);
  }

  const resolved = path.resolve(import.meta.dirname ?? process.cwd(), defPath);
  const raw = await fs.readFile(resolved, 'utf-8');
  const def = JSON.parse(raw) as EvalDefinition;

  const client = new OpenAI({ apiKey });

  // --- Create eval ---
  process.stdout.write(`Creating eval "${def.name}"...\n`);

  const evalResponse = await client.post('/v1/evals', {
    body: {
      name: def.name,
      data_source_config: def.data_source_config,
      testing_criteria: def.testing_criteria,
    },
  }) as { id: string; name: string };

  const evalId: string = evalResponse.id;
  process.stdout.write(`Eval created: ${evalId}\n`);

  // --- Create run ---
  process.stdout.write('Starting run...\n');

  const runResponse = await client.post(`/v1/evals/${evalId}/runs`, {
    body: {
      // Runs against the stored-completions dataset defined in the eval config.
      // No additional model override: the eval graders use their own judge model.
      data_source: { type: 'stored_completions' },
    },
  }) as { id: string; status: string };

  const runId: string = runResponse.id;
  process.stdout.write(`Run started: ${runId} (status: ${runResponse.status})\n`);

  // --- Poll ---
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));

    const poll = await client.get(`/v1/evals/${evalId}/runs/${runId}`) as {
      status: string;
      result_counts?: { passed: number; failed: number; total: number };
      per_testing_criteria_results?: Array<{
        name: string;
        passed: number;
        failed: number;
      }>;
      report_url?: string;
    };

    process.stdout.write(`[${String(attempt + 1)}/${String(MAX_POLL_ATTEMPTS)}] status: ${poll.status}\n`);

    if (poll.status === 'completed' || poll.status === 'failed') {
      if (poll.result_counts) {
        const { passed, total } = poll.result_counts;
        const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
        process.stdout.write(`\nResults: ${String(passed)}/${String(total)} passed (${String(pct)}%)\n`);
      }

      if (poll.per_testing_criteria_results) {
        process.stdout.write('\nPer-criteria breakdown:\n');
        for (const c of poll.per_testing_criteria_results) {
          const total = c.passed + c.failed;
          const pct = total > 0 ? Math.round((c.passed / total) * 100) : 0;
          process.stdout.write(`  ${c.name}: ${String(c.passed)}/${String(total)} (${String(pct)}%)\n`);
        }
      }

      if (poll.report_url) {
        process.stdout.write(`\nDashboard: ${poll.report_url}\n`);
      }

      process.exit(poll.status === 'completed' ? 0 : 1);
    }
  }

  process.stderr.write(`Timed out after ${String(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000)}s\n`);
  process.exit(1);
}

main().catch((err: unknown) => {
  process.stderr.write(String(err instanceof Error ? err.message : err) + '\n');
  process.exit(1);
});
