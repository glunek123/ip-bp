import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireLocalLock } from './local-lock.mjs';
import { captureTestEnvironment } from './test-environment.mjs';
import { validationScope } from './validation-scopes.mjs';

const evidenceVersion = 2;
const evidenceProtocol = 'dev-cor-validation-v2';
const attemptStatuses = new Set(['running', 'success', 'failed', 'aborted']);

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commonEvidenceDirectory(root) {
  return join(
    resolve(root, git(root, 'rev-parse', '--git-common-dir')),
    'dev-cor-validation-evidence',
  );
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

export function captureValidationCandidate(root) {
  return candidate(root);
}

export function assertValidationCandidate(root, expected) {
  const current = candidate(root);
  if (current.commit !== expected.commit || current.tree !== expected.tree) {
    throw new Error(
      `Validation candidate changed during checks: expected ${expected.commit}/${expected.tree}, found ${current.commit}/${current.tree}`,
    );
  }
  return current;
}

function normalizeEnvironment(environment) {
  if (
    typeof environment?.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(environment.fingerprint)
  ) {
    throw new Error('Validation evidence requires an environment fingerprint');
  }
  const metadata = environment.metadata;
  for (const key of ['node', 'pnpm', 'platform', 'architecture']) {
    if (typeof metadata?.[key] !== 'string' || metadata[key].length === 0)
      throw new Error(
        `Validation evidence requires environment metadata: ${key}`,
      );
  }
  return {
    fingerprint: environment.fingerprint,
    node: metadata.node,
    pnpm: metadata.pnpm,
    platform: metadata.platform,
    architecture: metadata.architecture,
  };
}

function scopeRequest(name, environment, fixedCandidate) {
  const configured = validationScope(name);
  return {
    protocol: evidenceProtocol,
    tree: fixedCandidate.tree,
    commit: fixedCandidate.commit,
    level: configured.level,
    scope: name,
    checks: configured.commands.map(({ id }) => id),
    environment: normalizeEnvironment(environment),
  };
}

function requestKey(request) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        protocol: request.protocol,
        tree: request.tree,
        level: request.level,
        scope: request.scope,
        checks: request.checks,
        environment: request.environment,
      }),
    )
    .digest('hex');
}

function evidencePath(root, tree) {
  return join(commonEvidenceDirectory(root), `${tree}.json`);
}

function emptyEvidence(tree) {
  return { version: evidenceVersion, tree, records: [] };
}

function readEvidence(path, tree) {
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (
      value?.version !== evidenceVersion ||
      value.tree !== tree ||
      !Array.isArray(value.records)
    ) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function atomicWrite(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    renameSync(temporary, path);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function updateEvidence(root, tree, update) {
  const directory = commonEvidenceDirectory(root);
  mkdirSync(directory, { recursive: true });
  const writeLock = acquireLocalLock(
    join(directory, 'locks'),
    'evidence-write',
  );
  try {
    const path = evidencePath(root, tree);
    const evidence = readEvidence(path, tree) ?? emptyEvidence(tree);
    update(evidence.records);
    atomicWrite(path, evidence);
    return path;
  } finally {
    writeLock.release();
  }
}

function recordFor(request, key, attemptId, status, startedAt) {
  return {
    key,
    attemptId,
    commit: request.commit,
    level: request.level,
    scope: request.scope,
    checks: request.checks,
    environment: request.environment,
    status,
    startedAt,
    ...(status === 'running' ? {} : { completedAt: new Date().toISOString() }),
  };
}

export function beginValidationScopeAttempt(
  root,
  name,
  environment,
  fixedCandidate,
) {
  if (
    typeof fixedCandidate?.commit !== 'string' ||
    typeof fixedCandidate?.tree !== 'string'
  ) {
    throw new Error('Validation attempt requires a captured candidate');
  }
  assertValidationCandidate(root, fixedCandidate);
  const request = scopeRequest(name, environment, fixedCandidate);
  const key = requestKey(request);
  const lock = acquireLocalLock(
    join(commonEvidenceDirectory(root), 'locks'),
    `attempt-${key}`,
  );
  const attemptId = randomUUID();
  const startedAt = new Date().toISOString();
  let path;
  try {
    path = updateEvidence(root, request.tree, (records) => {
      const next = recordFor(request, key, attemptId, 'running', startedAt);
      const existing = records.findIndex((record) => record?.key === key);
      if (existing === -1) records.push(next);
      else records[existing] = next;
    });
  } catch (error) {
    lock.release();
    throw error;
  }
  return {
    path,
    key,
    attemptId,
    tree: request.tree,
    commit: request.commit,
    request,
    release: () => lock.release(),
  };
}

function finishAttempt(root, attempt, status) {
  if (!attemptStatuses.has(status) || status === 'running')
    throw new Error(`Invalid final validation status: ${status}`);
  const path = updateEvidence(root, attempt.tree, (records) => {
    const index = records.findIndex((record) => record?.key === attempt.key);
    if (
      index === -1 ||
      records[index]?.attemptId !== attempt.attemptId ||
      records[index]?.status !== 'running'
    ) {
      throw new Error('Validation attempt is no longer the current attempt');
    }
    records[index] = recordFor(
      attempt.request,
      attempt.key,
      attempt.attemptId,
      status,
      records[index].startedAt,
    );
  });
  attempt.path = path;
  return { ...attempt, status };
}

export function completeValidationScopeAttempt(root, attempt) {
  return finishAttempt(root, attempt, 'success');
}

export function failValidationScopeAttempt(root, attempt, status = 'failed') {
  if (status !== 'failed' && status !== 'aborted')
    throw new Error('Failed attempts must be marked failed or aborted');
  return finishAttempt(root, attempt, status);
}

function isReusableRecord(record, request, key) {
  return (
    record?.key === key &&
    typeof record.attemptId === 'string' &&
    typeof record.commit === 'string' &&
    /^[0-9a-f]{40,64}$/.test(record.commit) &&
    record.level === request.level &&
    record.scope === request.scope &&
    record.status === 'success' &&
    typeof record.startedAt === 'string' &&
    typeof record.completedAt === 'string' &&
    JSON.stringify(record.checks) === JSON.stringify(request.checks) &&
    JSON.stringify(record.environment) === JSON.stringify(request.environment)
  );
}

export function findReusableValidationScopeEvidence(root, name, environment) {
  const configured = validationScope(name);
  void configured;
  let fixed;
  try {
    fixed = candidate(root);
  } catch {
    return undefined;
  }
  const request = scopeRequest(name, environment, fixed);
  const key = requestKey(request);
  const evidence = readEvidence(evidencePath(root, fixed.tree), fixed.tree);
  if (!evidence) return undefined;
  const record = evidence.records.find((item) => item?.key === key);
  return isReusableRecord(record, request, key)
    ? { tree: fixed.tree, ...record }
    : undefined;
}

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || value === undefined)
      throw new Error('Usage: validation-evidence.mjs check --scope name');
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
    if (command !== 'check') throw new Error('Evidence command must be check');
    const options = parseArguments(process.argv.slice(3));
    if (!options.scope || Object.keys(options).length !== 1)
      throw new Error('Evidence check requires only --scope name');
    const environment = captureTestEnvironment(root, {
      pnpmVersion: currentPnpmVersion(),
    });
    const result = findReusableValidationScopeEvidence(
      root,
      options.scope,
      environment,
    );
    if (!result) {
      console.error(
        'No reusable validation evidence matches this exact tree, scope, checks, and environment',
      );
      process.exitCode = 1;
    } else {
      console.log(`Reusable validation evidence found for tree ${result.tree}`);
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Evidence command failed',
    );
    process.exitCode = 1;
  }
}
