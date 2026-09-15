import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { checkContext, recordContext } from './context-memory.mjs';

const status =
  '# 当前开发状态\n\n## 当前阶段\n通用骨架\n## 当前任务\n检查\n## 已实现\n健康检查\n## 未决与限制\n需求待确认\n## 最近验证\n未运行业务测试\n## 下一步\n等待需求\n';

function fixture(t) {
  const prefix = join(tmpdir(), 'dev-cor-context-');
  const root = mkdtempSync(prefix);
  t.onTestFinished(() => {
    assert.ok(resolve(root).startsWith(resolve(prefix)));
    assert.equal(
      resolve(root).slice(
        resolve(tmpdir()).length,
        resolve(tmpdir()).length + 1,
      ),
      sep,
    );
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'docs'));
  mkdirSync(join(root, 'backend', 'src'), { recursive: true });
  writeFileSync(join(root, 'docs/project-status.md'), status);
  writeFileSync(
    join(root, 'backend/src/main.ts'),
    'export const ready = true;\n',
  );
  return root;
}

test('missing checkpoint fails instead of inventing a completed state', (t) => {
  assert.throws(() => checkContext(fixture(t)), /snapshot|快照/i);
});

test('recorded and unchanged files pass without changing the status document', (t) => {
  const root = fixture(t);
  recordContext(root);
  assert.doesNotThrow(() => checkContext(root));
  assert.equal(
    readFileSync(join(root, 'docs/project-status.md'), 'utf8'),
    status,
  );
});

test('a changed source invalidates the checkpoint and cannot be blindly recorded', (t) => {
  const root = fixture(t);
  recordContext(root);
  const before = readFileSync(join(root, 'docs/context-snapshot.json'), 'utf8');
  writeFileSync(
    join(root, 'backend/src/main.ts'),
    'export const ready = false;\n',
  );
  assert.throws(() => checkContext(root), /backend\/src\/main.ts/);
  assert.throws(() => recordContext(root), /project-status.md/);
  assert.equal(
    readFileSync(join(root, 'docs/context-snapshot.json'), 'utf8'),
    before,
  );
});

test('status update plus explicit recording acknowledges a reviewed change', (t) => {
  const root = fixture(t);
  recordContext(root);
  writeFileSync(
    join(root, 'backend/src/main.ts'),
    'export const ready = false;\n',
  );
  writeFileSync(
    join(root, 'docs/project-status.md'),
    `${status}\n检查点：源文件已修改，等待测试。\n`,
  );
  recordContext(root);
  assert.doesNotThrow(() => checkContext(root));
});

test('new files and deleted files both invalidate the checkpoint', (t) => {
  const root = fixture(t);
  recordContext(root);
  writeFileSync(join(root, 'backend/src/new.ts'), 'export {};\n');
  assert.throws(() => checkContext(root), /backend\/src\/new.ts/);
  rmSync(join(root, 'backend/src/main.ts'));
  assert.throws(() => checkContext(root), /backend\/src\/main.ts/);
});

test('documentation and Demo changes are tracked', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'demo'));
  writeFileSync(join(root, 'demo/index.html'), '<h1>Demo</h1>');
  recordContext(root);
  writeFileSync(join(root, 'demo/index.html'), '<h1>Updated Demo</h1>');
  writeFileSync(join(root, 'docs/decision.md'), '# New decision');
  assert.throws(() => checkContext(root), /demo\/index.html/);
  assert.throws(() => recordContext(root), /project-status.md/);
});

test('generated files and secrets do not enter the checkpoint', (t) => {
  const root = fixture(t);
  recordContext(root);
  mkdirSync(join(root, 'backend/src/generated'), { recursive: true });
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'backend/src/generated/client.ts'), 'generated');
  writeFileSync(join(root, 'node_modules/index.js'), 'dependency');
  writeFileSync(join(root, '.env'), 'secret-password');
  writeFileSync(join(root, 'backend/.env.test'), 'test-secret');
  assert.doesNotThrow(() => checkContext(root));
  const snapshot = readFileSync(
    join(root, 'docs/context-snapshot.json'),
    'utf8',
  );
  assert.ok(!snapshot.includes('.env'));
  assert.ok(!snapshot.includes('secret'));
});

test('broken local document links prevent recording', (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, 'docs/project-status.md'),
    `${status}\n[missing](missing.md)\n`,
  );
  assert.throws(() => recordContext(root), /missing.md/);
});

test('examples in code fences are not mistaken for live document links', (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, 'docs/project-status.md'),
    `${status}\n\x60\x60\x60markdown\n[example](missing.md)\n\x60\x60\x60\n`,
  );
  assert.doesNotThrow(() => recordContext(root));
});

test('incomplete status documents cannot be recorded', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'docs/project-status.md'), '# Done');
  assert.throws(() => recordContext(root), /当前任务|状态/);
});

test('corrupt snapshot is reported and not silently replaced', (t) => {
  const root = fixture(t);
  recordContext(root);
  writeFileSync(join(root, 'docs/context-snapshot.json'), '{"version": 999}');
  assert.throws(() => checkContext(root), /snapshot|快照/i);
  assert.throws(() => recordContext(root), /snapshot|快照/i);
});

test('line-ending-only changes do not invalidate the checkpoint', (t) => {
  const root = fixture(t);
  recordContext(root);
  writeFileSync(
    join(root, 'backend/src/main.ts'),
    'export const ready = true;\r\n',
  );
  assert.doesNotThrow(() => checkContext(root));
});
