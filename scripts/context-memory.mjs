import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const snapshotPath = 'docs/context-snapshot.json';
const statusPath = 'docs/project-status.md';
const ignoredDirectories = new Set([
  'node_modules',
  '.git',
  '.codegraph',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  '.local',
]);
const textExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.cmd',
  '.vue',
  '.html',
  '.css',
  '.scss',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.mdc',
  '.toml',
  '.sql',
  '.prisma',
  '.ps1',
  '.psm1',
  '.sh',
  '.svg',
  '.patch',
]);
const namedFiles = new Set([
  '.npmrc',
  '.node-version',
  '.gitignore',
  '.prettierignore',
  '.dockerignore',
  '.editorconfig',
  '.gitattributes',
  'Dockerfile',
]);
const sections = [
  '当前阶段',
  '当前任务',
  '已实现',
  '未决与限制',
  '最近验证',
  '下一步',
];

function readText(path) {
  return readFileSync(path, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

function collectFiles(root, directory = '') {
  const files = [];
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  })) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    const exampleEnv =
      entry.name === '.env.example' || /^\.env\..+\.example$/.test(entry.name);
    if (entry.name.startsWith('.env') && !exampleEnv) continue;
    if (
      ignoredDirectories.has(entry.name) ||
      relative === 'backend/src/generated' ||
      relative === snapshotPath
    )
      continue;
    if (entry.isSymbolicLink())
      throw new Error(
        `Review authored symbolic link before recording: ${relative}`,
      );
    if (entry.isDirectory()) files.push(...collectFiles(root, relative));
    else if (
      entry.isFile() &&
      (textExtensions.has(extname(entry.name).toLowerCase()) ||
        namedFiles.has(entry.name) ||
        exampleEnv)
    )
      files.push(relative);
  }
  return files.sort();
}

function inspectFiles(root) {
  if (!existsSync(join(root, statusPath)))
    throw new Error(`Missing 状态文档: ${statusPath}`);
  const status = readText(join(root, statusPath));
  for (const section of sections) {
    if (!status.split('\n').includes(`## ${section}`))
      throw new Error(`状态文档缺少 ${section}: ${statusPath}`);
  }
  const files = {};
  for (const relative of collectFiles(root)) {
    const text = readText(join(root, relative));
    files[relative] = digest(text);
    if (!relative.endsWith('.md')) continue;
    const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
    for (const match of prose.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].trim().replace(/^<|>$/g, '');
      if (
        /^[a-z][a-z0-9+.-]*:/i.test(target) ||
        target.startsWith('#') ||
        target.startsWith('//')
      )
        continue;
      const localPath = decodeURIComponent(target.split('#')[0]);
      if (
        localPath &&
        !existsSync(resolve(root, dirname(relative), localPath))
      ) {
        throw new Error(`Broken document link: ${relative} -> ${target}`);
      }
    }
  }
  return files;
}

function loadSnapshot(root) {
  const path = join(root, snapshotPath);
  if (!existsSync(path)) return undefined;
  let data;
  try {
    data = JSON.parse(readText(path));
  } catch {
    throw new Error(
      'Invalid context snapshot JSON; recover the checkpoint instead of replacing it blindly',
    );
  }
  if (
    data?.version !== 1 ||
    !data.files ||
    typeof data.files !== 'object' ||
    Array.isArray(data.files) ||
    !data.files[statusPath] ||
    Object.values(data.files).some(
      (value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value),
    )
  ) {
    throw new Error(
      'Invalid context snapshot schema; recover the checkpoint instead of replacing it blindly',
    );
  }
  return data;
}

function differences(previous, current) {
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .sort()
    .flatMap((path) => {
      if (!(path in previous)) return [`ADDED ${path}`];
      if (!(path in current)) return [`DELETED ${path}`];
      return previous[path] !== current[path] ? [`MODIFIED ${path}`] : [];
    });
}

const lightRecordPrefixes = ['demo/', 'frontend/src/styles/'];

function assertLightRecordChanges(changes) {
  const blocked = changes.filter((change) => {
    const path = change.slice(change.indexOf(' ') + 1);
    return !lightRecordPrefixes.some((prefix) => path.startsWith(prefix));
  });
  if (blocked.length) {
    throw new Error(
      `Light context recording is limited to Demo and frontend style assets. Use the standard checkpoint for:\n${blocked.join('\n')}`,
    );
  }
}

export function checkContext(root, { strict = false } = {}) {
  const files = inspectFiles(root);
  const snapshot = loadSnapshot(root);
  if (!snapshot)
    throw new Error(
      'Missing context snapshot; review docs/project-status.md and record an explicit checkpoint',
    );
  const changes = differences(snapshot.files, files);
  if (strict && changes.length)
    throw new Error(
      `Context snapshot drift (${changes.length} files):\n${changes.join('\n')}\n核对代码、验证结果与 project-status.md 后再记录；不要直接刷新。`,
    );
  return {
    count: Object.keys(files).length,
    recordedAt: snapshot.recordedAt,
    changes,
  };
}

export function recordContext(root, { mode = 'standard' } = {}) {
  const files = inspectFiles(root);
  const previous = loadSnapshot(root);
  if (mode === 'light' && !previous) {
    throw new Error(
      'Light context recording requires an existing trusted snapshot; use the standard checkpoint',
    );
  }
  const changes = previous ? differences(previous.files, files) : [];
  if (mode === 'light') assertLightRecordChanges(changes);
  const snapshot = { version: 1, recordedAt: new Date().toISOString(), files };
  const target = join(root, snapshotPath);
  writeFileSync(
    `${target}.tmp`,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
  renameSync(`${target}.tmp`, target);
  return { count: Object.keys(files).length, recordedAt: snapshot.recordedAt };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const command = process.argv[2];
    const strict = process.argv.slice(3).includes('--strict');
    if (!['check', 'record', 'record-light'].includes(command))
      throw new Error(
        'Usage: node scripts/context-memory.mjs check [--strict]|record|record-light',
      );
    if (strict && command !== 'check')
      throw new Error('--strict is only valid with the check command');
    const result =
      command === 'check'
        ? checkContext(root, { strict })
        : recordContext(root, {
            mode: command === 'record-light' ? 'light' : 'standard',
          });
    if (command === 'check' && result.changes.length) {
      console.warn(
        `Context snapshot drift (${result.changes.length} files):\n${result.changes.join('\n')}\nReview git status/diff and task overlap before continuing; do not refresh blindly.`,
      );
    }
    console.log(
      `Context ${command}: ${result.count} tracked text files; checkpoint ${result.recordedAt}. File consistency only; not a test or semantic approval.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Context check failed',
    );
    process.exitCode = 1;
  }
}
