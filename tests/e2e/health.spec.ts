import { expect, test } from '@playwright/test';

test('browser reaches the API and the real PostgreSQL test database', async ({
  page,
  request,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  const response = await request.get('/api/v1/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', database: 'up' });
  const documentation = await request.get('/api/docs-json');
  expect(documentation.status()).toBe(200);
  const contract = await documentation.json();
  expect(contract.paths['/api/v1/health'].get.responses).toHaveProperty('503');
  expect(contract.components.schemas.HealthResponseDto.required).toEqual([
    'status',
    'database',
  ]);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '连接正常', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('数据库已连接', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/connection-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '重新检查' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/connection-mobile.png',
    fullPage: true,
  });
  expect(pageErrors).toEqual([]);
});

test('a failed response is visible and retry can recover', async ({ page }) => {
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'DATABASE_UNAVAILABLE',
        message: '数据库暂时不可用',
        requestId: 'browser-test',
      }),
    }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '连接失败', exact: true }),
  ).toBeVisible();
  await page.unroute('**/api/v1/health');
  await page.getByRole('button', { name: '重新检查' }).click();
  await expect(
    page.getByRole('heading', { name: '连接正常', exact: true }),
  ).toBeVisible();
});
