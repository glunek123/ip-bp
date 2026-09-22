import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

const FULL_NAME = '品维·知产业务管理系统';
const SHORT_NAME = '品维·知产业务管理';

const fullNameFiles = [
  'README.md',
  'frontend/index.html',
  'backend/src/main.ts',
  'demo/README.md',
  'demo/index.html',
  'demo/DESIGN.md',
  'demo/styles.css',
  'demo/app.js',
];

const shortNameFiles = [
  'frontend/src/app/HealthPage.vue',
  'frontend/src/modules/auth/LoginPage.vue',
];
const authenticatedShellFile = 'frontend/src/app/AppShell.vue';

test('active product surfaces use the approved dual-department name', () => {
  for (const path of fullNameFiles) {
    const content = readFileSync(path, 'utf8');
    assert.match(
      content,
      new RegExp(FULL_NAME),
      `${path} must use the full name`,
    );
    assert.doesNotMatch(
      content,
      /知产案件管理/,
      `${path} still uses the old name`,
    );
  }

  for (const path of shortNameFiles) {
    const content = readFileSync(path, 'utf8');
    assert.match(
      content,
      new RegExp(SHORT_NAME),
      `${path} must use the short name`,
    );
    assert.doesNotMatch(
      content,
      /知产案件管理/,
      `${path} still uses the old name`,
    );
  }

  const authenticatedShell = readFileSync(authenticatedShellFile, 'utf8');
  assert.match(
    authenticatedShell,
    /品维·知产/,
    `${authenticatedShellFile} must use the approved brand name`,
  );
  assert.match(
    authenticatedShell,
    /业务管理系统/,
    `${authenticatedShellFile} must use the approved product descriptor`,
  );
  assert.doesNotMatch(
    authenticatedShell,
    /知产案件管理/,
    `${authenticatedShellFile} still uses the old name`,
  );
});
