import { test, expect } from '@playwright/test';

interface OpenClothSummary {
  name: string;
  panels: number;
  seams: number;
  fabrics: number;
  sizes: number;
}

interface OpenClothApi {
  getSummary(): OpenClothSummary;
  getProjectJson(): string;
}

/** The automation facade is installed before the first paint and reads the starter project. */
test('公开 API 返回起步工程摘要', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('正在初始化 WebGPU 渲染器…')).toBeHidden();

  const result = await page.evaluate(() => {
    const api = (window as Window & { opencloth?: OpenClothApi }).opencloth;
    if (!api) return null;
    const summary = api.getSummary();
    return { summary, json: api.getProjectJson() };
  });

  expect(result, 'window.opencloth 未安装').not.toBeNull();
  expect(result!.summary.panels).toBeGreaterThan(0);
  expect(JSON.parse(result!.json).pattern).toBeTruthy();
});

/** Menu shell is present even before a WebGPU context finishes the first frame. */
test('文件菜单与撤销入口存在', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('正在初始化 WebGPU 渲染器…')).toBeHidden();
  await expect(page.getByText('文件', { exact: true }).first()).toBeVisible();
  await page.getByText('文件', { exact: true }).first().click();
  await expect(page.getByText('新建工程', { exact: true }).first()).toBeVisible();
});
