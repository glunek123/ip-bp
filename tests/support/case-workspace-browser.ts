import { expect, type Page } from '@playwright/test';

async function expectWorkspaceDrawer(page: Page): Promise<void> {
  const drawer = page.locator('.case-workspace-editors[role="dialog"]');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS('display', 'flex');
  await expect(drawer).toHaveCSS('position', 'absolute');
  await expect(page.locator('.el-overlay.is-drawer:visible')).toHaveCSS(
    'position',
    'fixed',
  );
  await expect(drawer).toHaveCSS('right', '0px');
}

export async function closeCaseWorkspaceDrawer(page: Page): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith('/cases/')) return;
  const drawer = page.locator('.case-workspace-editors[role="dialog"]');
  if (await drawer.isVisible()) {
    await drawer.locator('.el-drawer__close-btn').click();
    await expect(drawer).not.toBeVisible();
  }
}

export async function openCaseWorkspaceCommand(
  page: Page,
  command: string,
  panelSelector: string,
): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith('/cases/')) return;
  await expect(page.locator('.case-workspace').first()).toBeVisible();
  if (await page.locator(panelSelector).isVisible()) {
    await expectWorkspaceDrawer(page);
    return;
  }
  await closeCaseWorkspaceDrawer(page);
  const previous = page.locator(
    `[data-test="workspace-prior-editor"][data-command="${command}"]`,
  );
  if (await previous.count()) {
    await page.getByRole('tab', { name: '案件详情', exact: true }).click();
    await previous.click();
    await expect(page.locator(panelSelector)).toBeVisible();
    await expectWorkspaceDrawer(page);
    return;
  }
  const more = page.locator(
    `[data-test="workspace-more-actions"] [data-command="${command}"]`,
  );
  if (await more.count()) {
    const menu = page.locator('[data-test="workspace-more-actions"]');
    if ((await menu.getAttribute('open')) === null)
      await menu.locator('summary').click();
    await more.click();
  } else await page.locator('[data-test="workspace-primary-action"]').click();
  await expect(page.locator('[data-test="workspace-command"]')).toBeVisible();
  await expect(
    page.locator(`[data-test="workspace-command"] option[value="${command}"]`),
  ).toHaveCount(1);
  await page.locator('[data-test="workspace-command"]').selectOption(command);
  await expect(page.locator(panelSelector)).toBeVisible();
  await expectWorkspaceDrawer(page);
}

export async function revealCaseWorkspaceSection(
  page: Page,
  section: string,
): Promise<void> {
  const toggle = page.locator(
    `[data-section="${section}"] .case-workspace-section__toggle`,
  );
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
}
