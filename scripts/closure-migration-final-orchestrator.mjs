// Explicitly invoked only after separate authorization for this isolated run.
// The resource runner verifies identities again before it creates or deletes.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { acquireE2eResourceLock } from './run-e2e.mjs';
import {
  prepareProbePlan,
  realIo,
  runProbe,
} from './closure-migration-final-probe.mjs';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, '.local/closure-final-20261030');
const runner = resolve(directory, 'resource-runner.ps1');
const planPath = resolve(directory, 'reviewed-plan.json');
const manifestPath = resolve(directory, 'resource-manifest.json');
const bindingPath = resolve(directory, 'binding.json');
const reportPath = resolve(directory, 'probe-report.json');
const resultPath = resolve(directory, 'orchestrator-result.json');

function assertCandidate(plan) {
  if (JSON.stringify(plan) !== JSON.stringify(prepareProbePlan(root)))
    throw new Error('Reviewed candidate changed');
}

function runResource(mode, plan) {
  assertCandidate(plan);
  execFileSync(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-File', runner, '-Mode', mode],
    {
      cwd: root,
      stdio: 'pipe',
      timeout: 180000,
    },
  );
}

async function main() {
  if ([manifestPath, bindingPath, reportPath, resultPath].some(existsSync))
    throw new Error('Existing execution evidence must be retained');
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  assertCandidate(plan);

  const lock = acquireE2eResourceLock();
  let cleanup = 'NOT_CREATED';
  let status = 'STOPPED';
  try {
    runResource('Prepare', plan);
    const binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const io = realIo(root);
    // The owner is this process, spanning creation, SQL and cleanup. The probe
    // borrows that lock and must not release it before cleanup finishes.
    io.acquireLock = () => ({ release() {} });
    const report = await runProbe(
      { root, plan, binding, candidateRoot: manifest.candidateRoot },
      io,
    );
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    status = report.status;
  } finally {
    cleanup = 'RETAINED_FOR_COORDINATED_CLEANUP';
    writeFileSync(
      resultPath,
      JSON.stringify({ status, cleanup, lock: 'HELD' }, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
    while (!existsSync(resolve(directory, 'release-lock-after-cleanup')))
      await new Promise((done) => setTimeout(done, 1000));
    try {
      lock.release();
    } catch {
      status = 'LOCK_RELEASE_FAILED';
    }
    writeFileSync(
      resolve(directory, 'lock-release-result.json'),
      JSON.stringify({ status, lock: 'RELEASED' }, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
  }
  if (!status.endsWith('_PASSED'))
    throw new Error('Probe or cleanup did not complete');
  console.log('Closed final probe completed; resources retained');
}

main().catch(() => {
  console.error(
    'Closed followup stopped; inspect sanitized result and retain uncertain resources',
  );
  process.exitCode = 1;
});
