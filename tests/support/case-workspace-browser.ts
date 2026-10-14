import { expect, type Page } from '@playwright/test';

export async function openCaseWorkspaceCommand(
  page: Page,
  command: string,
  panelSelector: string,
): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith('/cases/')) return;
  await expect(page.locator('.case-workspace').first()).toBeVisible();
  if (await page.locator(panelSelector).isVisible()) return;
  const more = page.locator(
    `[data-test="workspace-more-actions"] [data-command="${command}"]`,
  );
  if (await more.count()) {
    await page.locator('[data-test="workspace-more-actions"] summary').click();
    await more.click();
  } else await page.locator('[data-test="workspace-primary-action"]').click();
  await expect(page.locator('[data-test="workspace-command"]')).toBeVisible();
  await expect(
    page.locator(`[data-test="workspace-command"] option[value="${command}"]`),
  ).toHaveCount(1);
  await page.locator('[data-test="workspace-command"]').selectOption(command);
  await expect(page.locator(panelSelector)).toBeVisible();
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
