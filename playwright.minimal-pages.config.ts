import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { assertMinimalPageR2Binding } from './tests/support/minimal-page-acceptance.mjs';
import {
  createManagedTestRuntime,
  planManagedTestRuntime,
} from './scripts/managed-test-runtime.mjs';

const root = __dirname;
const args = process.argv.slice(2);
const listing = args.includes('--list');
const selected = [
  ['execution-feedback-minimal-page.spec.ts', 'EF_FEEDBACK'],
  ['lead-batch-push-minimal-page.spec.ts', 'LEAD_BATCH'],
] as const;
const selectedKinds = selected
  .filter(([file]) => args.some((arg) => arg.includes(file)))
  .map(([, kind]) => kind);
const kinds = selectedKinds.length
  ? selectedKinds
  : selected.map(([, kind]) => kind);
let admissionWindow: { runId: string; deadlineIso: string } | null = null;
if (
  args.some((arg) => /^--ui(?:=|$)/u.test(arg) || /^--watch(?:=|$)/u.test(arg))
)
  throw new Error('Minimal pages do not permit interactive execution');

// Config is loaded before webServer; globalSetup and test.beforeAll are too late.
// Playwright 1.63 requires a synchronous config object (it does not await a
// Promise default export). This bounded child finishes read-only admission
// before either managed server can start. --list performs no capture or I/O.
if (!listing) {
  assertMinimalPageR2Binding(process.env);
  const file = resolve(root, 'tests/support/minimal-page-acceptance.mjs');
  const script =
    'const u=await import("node:url");' +
    'const m=await import(u.pathToFileURL(process.argv[1]).href);' +
    'const runId=(await import("node:crypto")).randomUUID();' +
    'let deadlineIso;' +
    'try{' +
    'for(const kind of JSON.parse(process.argv[3])){' +
    'const run=m.createMinimalPageAcceptance(kind,{root:process.argv[2],runId,preflightOnly:true});' +
    'try{const value=await run.prepare();deadlineIso=deadlineIso?' +
    '(deadlineIso<value.deadlineIso?deadlineIso:value.deadlineIso):value.deadlineIso}' +
    'finally{await run.dispose()}}' +
    'process.stdout.write(JSON.stringify({runId,deadlineIso}))' +
    '}catch(e){process.stderr.write(String(e?.code??"MINIMAL_PAGE_PREFLIGHT"));process.exitCode=1}';
  try {
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script, file, root, JSON.stringify(kinds)],
      {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 90_000,
      },
    );
    admissionWindow = JSON.parse(output.toString('utf8'));
  } catch (error) {
    const raw = String((error as { stderr?: Buffer }).stderr ?? '').trim();
    const code = /^MINIMAL_PAGE_[A-Z_]+$/u.test(raw)
      ? raw
      : 'MINIMAL_PAGE_PREFLIGHT';
    throw new Error(`Minimal page pre-server R2 admission failed: ${code}`);
  }
}
const runtime = planManagedTestRuntime(createManagedTestRuntime(root, 'ui'));

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [
    'execution-feedback-minimal-page.spec.ts',
    'lead-batch-push-minimal-page.spec.ts',
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  timeout: 4 * 60_000,
  globalTimeout: 10 * 60_000,
  metadata: { minimalPageWindow: admissionWindow },
  reporter: [['list']],
  outputDir: resolve(
    tmpdir(),
    'dev-cor-minimal-page-acceptance',
    admissionWindow?.runId ?? 'offline-list',
  ),
  use: {
    baseURL: runtime.baseURL,
    trace: 'retain-on-failure',
    testIdAttribute: 'data-test',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: listing ? [] : runtime.webServer,
});
