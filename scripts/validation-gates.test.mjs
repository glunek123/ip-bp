import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { test } from 'vitest';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json')));
const backendPackage = JSON.parse(
  readFileSync(resolve(root, 'backend/package.json')),
);
const frontendPackage = JSON.parse(
  readFileSync(resolve(root, 'frontend/package.json')),
);

const sliceScripts = [
  'verify:slice:customer',
  'verify:slice:right-holder',
  'verify:slice:auth',
];

const e2eScripts = [
  'test:e2e:customer',
  'test:e2e:right-holder',
  'test:e2e:auth',
  'test:e2e:full',
];

const unitScripts = [
  'test:unit:customer',
  'test:unit:right-holder',
  'test:unit:auth',
];

test('explicit slice and database E2E gates are defined', () => {
  for (const name of [...sliceScripts, ...unitScripts, ...e2eScripts]) {
    assert.equal(typeof packageJson.scripts[name], 'string', name);
    assert.ok(packageJson.scripts[name].length > 0, name);
  }
});

test('slice gates stay scoped and never turn zero tests into success', () => {
  assert.equal(
    packageJson.scripts['verify:slice:customer'],
    'node scripts/run-validation-scope.mjs customer',
  );
  assert.equal(
    packageJson.scripts['verify:slice:right-holder'],
    'node scripts/run-validation-scope.mjs right-holder',
  );
  assert.equal(
    packageJson.scripts['verify:slice:auth'],
    'node scripts/run-validation-scope.mjs auth-focused',
  );
  assert.equal(packageJson.scripts['evidence:record'], undefined);
  for (const command of Object.values(packageJson.scripts)) {
    assert.doesNotMatch(command, /passWithNoTests|pass-with-no-tests/);
    assert.doesNotMatch(command, /validation-evidence\.mjs record/);
  }
  for (const name of unitScripts) {
    assert.doesNotMatch(
      packageJson.scripts[name],
      /\btest -- /,
      `${name} must forward file filters instead of a literal separator`,
    );
  }
});

test('scoped E2E commands reuse the guarded runner and full remains explicit', () => {
  assert.match(packageJson.scripts['test:e2e:customer'], /run-e2e\.mjs/);
  assert.match(packageJson.scripts['test:e2e:right-holder'], /--grep/);
  assert.match(packageJson.scripts['test:e2e:auth'], /auth\.spec\.ts/);
  assert.equal(
    packageJson.scripts['test:e2e:full'],
    'node scripts/run-e2e.mjs',
  );
});

test('full verify prepares Prisma and typechecks the frontend only once', () => {
  assert.match(packageJson.scripts.verify, /context:check:strict/);
  assert.match(packageJson.scripts.verify, /prepare:prisma/);
  assert.match(packageJson.scripts.verify, /typecheck:prepared/);
  assert.match(packageJson.scripts.verify, /build:prepared/);
  assert.equal(
    backendPackage.scripts.typecheck,
    'pnpm db:generate && pnpm typecheck:prepared',
  );
  assert.equal(
    backendPackage.scripts.build,
    'pnpm db:generate && pnpm build:prepared',
  );
  assert.equal(backendPackage.scripts['typecheck:prepared'], 'tsc --noEmit');
  assert.equal(
    backendPackage.scripts['build:prepared'],
    'tsc -p tsconfig.build.json',
  );
  assert.equal(
    frontendPackage.scripts.build,
    'pnpm typecheck && pnpm build:bundle',
  );
  assert.equal(frontendPackage.scripts['build:bundle'], 'vite build');
  assert.doesNotMatch(packageJson.scripts['build:prepared'], /vue-tsc/);
});
