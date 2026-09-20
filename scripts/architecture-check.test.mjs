import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { auditArchitecture } from './architecture-check.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'dev-cor-architecture-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  return root;
}

const schema = 'model Customer {\n  id String @id\n}\n';

test('accepts local imports and another module public entry', (t) => {
  const root = fixture(t, {
    'backend/prisma/schema.prisma': schema,
    'backend/src/modules/customers/local.ts': 'export const local = 1;\n',
    'backend/src/modules/customers/use.ts': "import './local';\n",
    'backend/src/modules/cases/index.ts': 'export const cases = 1;\n',
    'backend/src/modules/customers/public-use.ts':
      "import { cases } from '../cases/index'; void cases;\n",
  });

  assert.deepEqual(
    auditArchitecture(root, { Customer: 'customers' }).errors,
    [],
  );
});

test('rejects static and dynamic imports of another module internals', (t) => {
  const root = fixture(t, {
    'backend/prisma/schema.prisma': schema,
    'backend/src/modules/cases/internal.ts': 'export const secret = 1;\n',
    'backend/src/modules/customers/static.ts':
      "import { secret } from '../cases/internal'; void secret;\n",
    'backend/src/modules/customers/dynamic.ts':
      "export const load = () => import('../cases/internal');\n",
  });

  const errors = auditArchitecture(root, {
    Customer: 'customers',
  }).errors.join('\n');
  assert.match(errors, /ARCH-MODULE-IMPORT/);
  assert.match(errors, /static\.ts/);
  assert.match(errors, /dynamic\.ts/);
});

test('checks Vue imports using the same public-entry rule', (t) => {
  const root = fixture(t, {
    'backend/prisma/schema.prisma': schema,
    'frontend/src/modules/cases/internal.ts': 'export const secret = 1;\n',
    'frontend/src/modules/customers/Page.vue':
      '<script setup lang="ts">\nimport { secret } from \'../cases/internal\';\nvoid secret;\n</script>\n',
  });

  assert.match(
    auditArchitecture(root, { Customer: 'customers' }).errors.join('\n'),
    /ARCH-MODULE-IMPORT.*Page\.vue/,
  );
});

test('requires exact ownership coverage for every Prisma model', (t) => {
  const root = fixture(t, {
    'backend/prisma/schema.prisma': `${schema}model AuditEvent {\n  id String @id\n}\n`,
  });

  const errors = auditArchitecture(root, {
    Customer: 'customers',
    Ghost: 'none',
  }).errors.join('\n');
  assert.match(errors, /ARCH-MODEL-OWNER.*AuditEvent/);
  assert.match(errors, /ARCH-MODEL-OWNER.*Ghost/);
});

test('ESLint blocks database imports in business controllers but preserves the health exception', async () => {
  const eslint = new ESLint({ cwd: projectRoot });
  const businessPath = join(
    projectRoot,
    'backend/src/modules/example/example.controller.ts',
  );
  const healthPath = join(
    projectRoot,
    'backend/src/health/health.controller.ts',
  );
  const source =
    "import { DatabaseService } from '../../database/database.service';\nvoid DatabaseService;\n";

  const [business] = await eslint.lintText(source, { filePath: businessPath });
  const [health] = await eslint.lintText(source, { filePath: healthPath });
  const restricted = (result) =>
    result.messages.filter(({ ruleId }) => ruleId === 'no-restricted-imports');

  assert.match(
    restricted(business)[0]?.message ?? '',
    /ARCH-CONTROLLER-DATABASE/,
  );
  assert.deepEqual(restricted(health), []);
});
