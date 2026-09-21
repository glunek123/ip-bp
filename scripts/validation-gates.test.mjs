import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { validationScopes } from './validation-scopes.mjs';

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
  'verify:slice:core-ld',
];

const e2eScripts = [
  'test:e2e:customer',
  'test:e2e:right-holder',
  'test:e2e:auth',
  'test:e2e:core-ld',
  'test:e2e:full',
];

const unitScripts = [
  'test:unit:customer',
  'test:unit:right-holder',
  'test:unit:auth',
  'test:unit:core-ld',
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
  assert.equal(
    packageJson.scripts['verify:slice:core-ld'],
    'node scripts/run-validation-scope.mjs core-ld',
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
    packageJson.scripts['test:e2e:core-ld'],
    'node scripts/run-e2e.mjs tests/e2e/core-leads.spec.ts',
  );
  assert.equal(
    packageJson.scripts['test:e2e:full'],
    'node scripts/run-e2e.mjs',
  );
  assert.equal(
    packageJson.scripts['db:test:migrate:deploy'],
    'pnpm --filter @dev-cor/backend db:migrate:deploy:test',
  );
  assert.match(
    backendPackage.scripts['db:migrate:deploy:test'],
    /run-test-migration\.mjs/,
  );
  assert.doesNotMatch(
    backendPackage.scripts['db:migrate:deploy:test'],
    /--env-file|DATABASE_URL/,
  );
});

test('formal slice scopes already subsume their immediate development checks', () => {
  const expected = {
    customer: [
      'prepare:prisma',
      'test:unit:customer',
      'check:fast:prepared',
      'format:check:slice:customer',
      'build:backend:prepared',
      'test:e2e:customer',
    ],
    'right-holder': [
      'prepare:prisma',
      'test:unit:right-holder',
      'check:fast:prepared',
      'format:check:slice:right-holder',
      'build:backend:prepared',
      'test:e2e:right-holder',
    ],
    'auth-focused': [
      'prepare:prisma',
      'test:unit:auth',
      'check:fast:prepared',
      'format:check:slice:auth',
      'build:backend:prepared',
      'test:e2e:auth',
    ],
    'core-ld': [
      'prepare:prisma',
      'test:unit:core-ld',
      'check:fast:prepared',
      'format:check:slice:core-ld',
      'build:backend:prepared',
      'test:e2e:core-ld',
    ],
  };

  for (const [name, ids] of Object.entries(expected)) {
    assert.deepEqual(
      validationScopes[name].commands.map(({ id }) => id),
      ids,
    );
  }
});

test('full engineering verify and database E2E remain separate sets', () => {
  assert.doesNotMatch(packageJson.scripts.verify, /test:e2e/);
  assert.equal(
    packageJson.scripts.verify.match(/architecture:check/g)?.length,
    1,
  );
  assert.equal(
    packageJson.scripts['test:e2e:full'],
    'node scripts/run-e2e.mjs',
  );
});

test('full verify prepares Prisma and typechecks the frontend only once', () => {
  assert.match(packageJson.scripts.verify, /context:check:strict/);
  assert.match(packageJson.scripts.verify, /architecture:check/);
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

test('prepared fast checks preserve typecheck and lint without regenerating Prisma', () => {
  assert.equal(
    packageJson.scripts['check:fast:prepared'],
    'pnpm architecture:check && pnpm typecheck:prepared && eslint . --cache --cache-strategy content --cache-location .local/eslint-cache --max-warnings 0',
  );
  assert.equal(
    packageJson.scripts['architecture:check'],
    'node scripts/architecture-check.mjs',
  );
  assert.equal(
    packageJson.scripts['typecheck:prepared'],
    'pnpm -r --parallel typecheck:prepared && tsc --noEmit',
  );
  assert.equal(
    frontendPackage.scripts['typecheck:prepared'],
    'vue-tsc --noEmit',
  );
  assert.match(packageJson.scripts['typecheck:prepared'], /tsc --noEmit/);
  assert.doesNotMatch(
    packageJson.scripts['check:fast:prepared'],
    /db:generate/,
  );
  assert.match(packageJson.scripts['check:fast'], /typecheck/);
  assert.equal(
    packageJson.scripts['check:fast'].match(/architecture:check/g)?.length,
    1,
  );
  assert.equal(
    packageJson.scripts['check:fast:prepared'].match(/architecture:check/g)
      ?.length,
    1,
  );
  for (const configured of Object.values(validationScopes)) {
    assert.equal(
      configured.commands.filter(({ id }) => id === 'architecture:check')
        .length,
      0,
    );
  }
});
