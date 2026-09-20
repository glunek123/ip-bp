import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertValidationCandidate,
  beginValidationScopeAttempt,
  captureValidationCandidate,
  completeValidationScopeAttempt,
  failValidationScopeAttempt,
} from './validation-evidence.mjs';
import { captureTestEnvironment } from './test-environment.mjs';
import { validationScope } from './validation-scopes.mjs';

function currentPnpmVersion() {
  const match = (process.env.npm_config_user_agent ?? '').match(
    /\bpnpm\/([^\s]+)/,
  );
  if (!match) throw new Error('Run the validation scope through pnpm');
  return match[1];
}

function executePnpm(root, command, childEnvironment) {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error('pnpm executable path is unavailable');
  execFileSync(process.execPath, [pnpmCli, ...command.args], {
    cwd: root,
    stdio: 'inherit',
    env: childEnvironment ?? process.env,
  });
}

function assertEnvironment(expected, current) {
  if (
    current.fingerprint !== expected.fingerprint ||
    JSON.stringify(current.metadata) !== JSON.stringify(expected.metadata)
  ) {
    throw new Error('Validation environment changed during checks');
  }
}

function abortedByInputChange(error) {
  return /candidate changed|environment changed|clean fixed candidate|conflicts with the fixed E2E environment/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export async function runValidationScope(root, name, dependencies = {}) {
  const configured = validationScope(name);
  const pnpmVersion = dependencies.pnpmVersion ?? currentPnpmVersion();
  const execute =
    dependencies.execute ??
    ((command, childEnvironment) =>
      executePnpm(root, command, childEnvironment));
  const captureCandidate =
    dependencies.captureCandidate ?? captureValidationCandidate;
  const assertCandidate =
    dependencies.assertCandidate ?? assertValidationCandidate;
  const captureEnvironment =
    dependencies.captureEnvironment ??
    ((repositoryRoot) =>
      captureTestEnvironment(repositoryRoot, { pnpmVersion }));
  const begin = dependencies.begin ?? beginValidationScopeAttempt;
  const succeed = dependencies.succeed ?? completeValidationScopeAttempt;
  const fail = dependencies.fail ?? failValidationScopeAttempt;

  const fixedCandidate = captureCandidate(root);
  const fixedEnvironment = captureEnvironment(root);
  const attempt = begin(root, name, fixedEnvironment, fixedCandidate);

  try {
    for (const command of configured.commands) {
      assertCandidate(root, fixedCandidate);
      assertEnvironment(fixedEnvironment, captureEnvironment(root));
      await execute(
        command,
        command.testEnvironment ? fixedEnvironment.childEnvironment : undefined,
      );
      assertCandidate(root, fixedCandidate);
      assertEnvironment(fixedEnvironment, captureEnvironment(root));
    }
    return succeed(root, attempt);
  } catch (error) {
    try {
      fail(root, attempt, abortedByInputChange(error) ? 'aborted' : 'failed');
    } catch {
      // A running record is deliberately non-reusable if final state cannot publish.
    }
    throw error;
  } finally {
    attempt.release();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const name = process.argv[2];
    if (!name || process.argv.length !== 3)
      throw new Error('Usage: run-validation-scope.mjs <scope>');
    const result = await runValidationScope(root, name);
    console.log(
      `Validation scope ${name} passed; evidence recorded for tree ${result.tree}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Validation failed');
    process.exitCode = 1;
  }
}
