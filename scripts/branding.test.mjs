import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

const APPROVED_NAME = '知产案管系统';
const LEGACY_NAMES = [
  '品维·知产业务管理系统',
  '品维·知产业务管理',
  '知产案件管理',
];

const productSurfaces = [
  {
    path: 'frontend/index.html',
    expectedMarkup: `<title>${APPROVED_NAME}</title>`,
  },
  {
    path: 'frontend/src/app/AppShell.vue',
    expectedMarkup: `<strong>${APPROVED_NAME}</strong>`,
  },
  {
    path: 'frontend/src/modules/auth/LoginPage.vue',
    expectedMarkup: `<h1>${APPROVED_NAME}</h1>`,
  },
  {
    path: 'frontend/src/app/HealthPage.vue',
    expectedMarkup: `<strong>${APPROVED_NAME}</strong>`,
  },
];

test('active product surfaces use the approved product name', () => {
  for (const { path, expectedMarkup } of productSurfaces) {
    const content = readFileSync(path, 'utf8');
    assert.ok(
      content.includes(expectedMarkup),
      `${path} must display the exact approved name: ${APPROVED_NAME}`,
    );
    for (const legacyName of LEGACY_NAMES) {
      assert.ok(
        !content.includes(legacyName),
        `${path} still displays the legacy name: ${legacyName}`,
      );
    }
  }

  const healthPage = readFileSync('frontend/src/app/HealthPage.vue', 'utf8');
  assert.ok(
    healthPage.includes(`<span>${APPROVED_NAME}</span>`),
    'HealthPage footer must display the exact approved name',
  );
});
