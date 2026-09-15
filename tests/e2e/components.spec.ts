import { expect, test } from '@playwright/test';

test('select and table retain interaction with the full plugin installed', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/compat/index.html');
  await page.getByText('请选择', { exact: true }).click();
  await page.getByRole('option', { name: 'Beta', exact: true }).click();
  await expect(page.getByTestId('selected')).toHaveText('beta');
  await page.locator('.el-select').getByText('Beta', { exact: true }).click();
  await page.getByRole('option', { name: 'Alpha', exact: true }).click();
  await expect(page.getByTestId('selected')).toHaveText('alpha');
  const bodyRows = page.locator('.el-table__body tbody tr');
  await expect(bodyRows).toHaveCount(2);
  await bodyRows.filter({ hasText: 'Beta' }).locator('.el-checkbox').click();
  await expect(
    bodyRows.filter({ hasText: 'Beta' }).getByRole('checkbox'),
  ).toBeChecked();
  await expect(page.getByTestId('selection')).toHaveText('2');
  await page.locator('.el-table__header .descending').click();
  await expect(bodyRows.first()).toContainText('Beta');
  await bodyRows.first().locator('.el-checkbox').click();
  await expect(bodyRows.first().getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByTestId('selection')).toHaveText('empty');
  expect(errors).toEqual([]);
});
