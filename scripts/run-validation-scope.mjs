import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  captureValidationCandidate,
  recordValidationScopeEvidence,
} from './validation-evidence.mjs';
import { validationScope } from './validation-scopes.mjs';

function currentPnpmVersion() {
  const match = (process.env.npm_config_user_agent ?? '').match(
    /\bpnpm\/([^\s]+)/,
  );
  if (!match) throw new Error('Run the validation scope through pnpm');
  return match[1];
}

function executePnpm(root, command) {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error('pnpm executable path is unavailable');
  execFileSync(process.execPath, [pnpmCli, ...command.args], {
    cwd: root,
    stdio: 'inherit',
  });
}

export async function runValidationScope(root, name, dependencies = {}) {
  const configured = validationScope(name);
  const execute =
    dependencies.execute ?? ((command) => executePnpm(root, command));
  const record = dependencies.record ?? recordValidationScopeEvidence;
  const capture = dependencies.capture ?? captureValidationCandidate;
  const candidate = capture(root);

  for (const command of configured.commands) await execute(command);

  return record(
    root,
    name,
    {
      nodeVersion: dependencies.nodeVersion ?? process.version,
      pnpmVersion: dependencies.pnpmVersion ?? currentPnpmVersion(),
    },
    candidate.tree,
  );
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
