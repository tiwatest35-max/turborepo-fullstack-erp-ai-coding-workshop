import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { NFR05, type LoadRun, type Verdict } from './verdict.js';

/** The archived evidence: one JSON file for machines and one Markdown report for people. */

export type RunFacts = {
  startedAt: Date;
  postgresVersion: string;
  run: LoadRun;
  verdict: Verdict;
};

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function environment(postgresVersion: string) {
  const cpu = cpus();
  return {
    node: process.version,
    os: `${platform()} ${release()}`,
    cpu: `${cpu[0]?.model.trim() ?? 'unknown'} x ${cpu.length}`,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    postgres: postgresVersion,
    commit: git('rev-parse', '--short', 'HEAD'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    note: 'The load generator, the API and Postgres ran on this one machine.',
  };
}

export function writeReport(dir: string, facts: RunFacts): { json: string; markdown: string } {
  const { run, verdict } = facts;
  const env = environment(facts.postgresVersion);
  const stamp = facts.startedAt.toISOString().replaceAll(/[:.]/g, '-');
  const seconds = run.durationMs / 1000;

  const payload = {
    requirement: 'NFR-05',
    result: verdict.passed ? 'PASS' : 'FAIL',
    startedAt: facts.startedAt.toISOString(),
    required: NFR05,
    dataset: run.dataset,
    virtualUsers: run.virtualUsers,
    durationSeconds: Number(seconds.toFixed(1)),
    problems: verdict.problems,
    endpoints: verdict.endpoints,
    environment: env,
  };

  const ms = (value: number) => value.toFixed(1);
  const rows = Object.entries(verdict.endpoints).map(([name, s]) => {
    const rate = (s.requests / seconds).toFixed(1);
    return `| ${name} | ${s.requests} | ${s.failedRequests} | ${rate} | ${ms(s.minMs)} | ${ms(s.p50Ms)} | **${ms(s.p95Ms)}** | ${ms(s.p99Ms)} | ${ms(s.maxMs)} |`;
  });

  const markdown = [
    `# NFR-05 performance load test: ${payload.result}`,
    '',
    `Run started ${payload.startedAt}. Requirement: p95 response time of at most ${NFR05.p95LimitMs} ms on the product-search and stock-view APIs at ${NFR05.virtualUsers} concurrent users over a continuous ${NFR05.durationMs / 60_000} minutes, on ${NFR05.products} products and ${NFR05.movements} stock movements. CSV exports are excluded.`,
    '',
    '## Run',
    '',
    `- Dataset: ${run.dataset.products} products, ${run.dataset.movements} stock movements`,
    `- Virtual users: ${run.virtualUsers}, each sending its next request as soon as the last answer was read`,
    `- Duration: ${seconds.toFixed(1)} s`,
    '',
    '## Response times (ms)',
    '',
    '| API | Requests | Failed | Req/s | Min | p50 | p95 | p99 | Max |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    verdict.passed
      ? `Both APIs are at or below ${NFR05.p95LimitMs} ms at p95. NFR-05 is met.`
      : ['NFR-05 is **not** met:', '', ...verdict.problems.map((problem) => `- ${problem}`)].join(
          '\n',
        ),
    '',
    '## Environment',
    '',
    `- Commit: ${env.commit} (${env.branch})`,
    `- Node ${env.node} on ${env.os}`,
    `- CPU: ${env.cpu}, ${env.memoryGb} GB memory`,
    `- ${env.postgres}`,
    `- ${env.note}`,
    '',
  ].join('\n');

  mkdirSync(dir, { recursive: true });
  const json = join(dir, `${stamp}.json`);
  const markdownPath = join(dir, `${stamp}.md`);
  writeFileSync(json, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(markdownPath, markdown);
  return { json, markdown: markdownPath };
}
