import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidenceVersion = 1;
const levels = new Set(['L1', 'L2', 'L3']);

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function normalizeRequest(request) {
  const level = request.level;
  const scope = request.scope;
  const checks = request.checks;
  if (!levels.has(level)) throw new Error(`Invalid evidence level: ${level}`);
  if (typeof scope !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(scope))
    throw new Error(`Invalid evidence scope: ${scope}`);
  if (!Array.isArray(checks) || checks.length === 0)
    throw new Error('Evidence requires at least one successful named check');
  if (
    checks.some(
      (check) =>
        typeof check !== 'string' ||
        !/^[a-z0-9][a-z0-9:.-]{0,127}$/.test(check),
    )
  )
    throw new Error('Invalid evidence check name');
  if (new Set(checks).size !== checks.length)
    throw new Error('Duplicate evidence check names are not allowed');
  if (
    typeof request.nodeVersion !== 'string' ||
    typeof request.pnpmVersion !== 'string'
  )
    throw new Error('Evidence requires Node and pnpm versions');
  return {
    level,
    scope,
    checks: [...checks],
    nodeVersion: request.nodeVersion,
    pnpmVersion: request.pnpmVersion,
  };
}

function candidate(root) {
  const status = git(root, 'status', '--porcelain', '--untracked-files=all');
  if (status)
    throw new Error(
      `Validation evidence requires a clean fixed candidate; dirty paths:\n${status}`,
    );
  return {
    commit: git(root, 'rev-parse', 'HEAD'),
    tree: git(root, 'rev-parse', 'HEAD^{tree}'),
  };
}

function evidencePath(root, tree) {
  return join(root, '.local', 'validation-evidence', `${tree}.json`);
}

export function recordEvidence(root, request) {
  const normalized = normalizeRequest(request);
  const fixed = candidate(root);
  const record = {
    commit: fixed.commit,
    level: normalized.level,
    scope: normalized.scope,
    checks: normalized.checks,
    environment: {
      node: normalized.nodeVersion,
      pnpm: normalized.pnpmVersion,
    },
    createdAt: new Date().toISOString(),
  };
  const path = evidencePath(root, fixed.tree);
  let evidence = { version: evidenceVersion, tree: fixed.tree, records: [] };
  if (existsSync(path)) {
    try {
      const existing = JSON.parse(readFileSync(path, 'utf8'));
      if (
        existing?.version === evidenceVersion &&
        existing.tree === fixed.tree &&
        Array.isArray(existing.records)
      )
        evidence = existing;
    } catch {
      // Replace corrupt local cache only after all candidate checks succeeded.
    }
  }
  evidence.records = evidence.records.filter(
    (item) =>
      !(
        item.level === record.level &&
        item.scope === record.scope &&
        item.environment?.node === record.environment.node &&
        item.environment?.pnpm === record.environment.pnpm &&
        JSON.stringify(item.checks) === JSON.stringify(record.checks)
      ),
  );
  evidence.records.push(record);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return { path, tree: fixed.tree, ...record };
}

export function findReusableEvidence(root, request) {
  const normalized = normalizeRequest(request);
  let fixed;
  try {
    fixed = candidate(root);
  } catch {
    return undefined;
  }
  const path = evidencePath(root, fixed.tree);
  if (!existsSync(path)) return undefined;
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
  if (
    evidence?.version !== evidenceVersion ||
    evidence.tree !== fixed.tree ||
    !Array.isArray(evidence.records)
  )
    return undefined;
  const record = evidence.records.find(
    (item) =>
      item.level === normalized.level &&
      item.scope === normalized.scope &&
      item.environment?.node === normalized.nodeVersion &&
      item.environment?.pnpm === normalized.pnpmVersion &&
      JSON.stringify(item.checks) === JSON.stringify(normalized.checks),
  );
  return record ? { tree: fixed.tree, ...record } : undefined;
}

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || value === undefined)
      throw new Error(
        'Usage: validation-evidence.mjs record|check --level L1|L2|L3 --scope name --checks comma,separated',
      );
    options[name.slice(2)] = value;
  }
  return options;
}

function currentPnpmVersion() {
  const userAgent = process.env.npm_config_user_agent ?? '';
  const match = userAgent.match(/\bpnpm\/([^\s]+)/);
  if (!match)
    throw new Error(
      'Run validation evidence through pnpm so its version is known',
    );
  return match[1];
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const command = process.argv[2];
    if (!['record', 'check'].includes(command))
      throw new Error('Evidence command must be record or check');
    const options = parseArguments(process.argv.slice(3));
    const request = {
      level: options.level,
      scope: options.scope,
      checks: options.checks?.split(',').filter(Boolean) ?? [],
      nodeVersion: process.version,
      pnpmVersion: currentPnpmVersion(),
    };
    if (command === 'record') {
      const result = recordEvidence(root, request);
      console.log(
        `Recorded validation evidence for tree ${result.tree}: ${result.path}`,
      );
    } else {
      const result = findReusableEvidence(root, request);
      if (!result) {
        console.error(
          'No reusable validation evidence matches this exact tree and request',
        );
        process.exitCode = 1;
      } else {
        console.log(
          `Reusable validation evidence found for tree ${result.tree}`,
        );
      }
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Evidence command failed',
    );
    process.exitCode = 1;
  }
}
