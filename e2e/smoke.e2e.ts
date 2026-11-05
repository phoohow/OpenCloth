import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

/** Smoke path: boot the built app, auto-dress the starter garment and export the screenshot PNG. */
test('自动着装并导出截图', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByText('正在初始化 WebGPU 渲染器…')).toBeHidden();

  const gpuMissing = await page.evaluate(() => {
    const banner = document.getElementById('webgpu-error');
    return banner !== null && getComputedStyle(banner).display !== 'none';
  });
  expect(gpuMissing, 'WebGPU 不可用，检查浏览器与显卡驱动').toBe(false);

  await expect(page.getByText('未着装 — 播放或执行「自动着装」开始缝合')).toBeVisible();
  await page.keyboard.press('Control+d');
  await expect(page.getByText('模拟中')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByText('文件', { exact: true }).click();
  await page.getByText('导出', { exact: true }).click();
  await page.getByText('图像：截图 PNG', { exact: true }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path, '截图下载未落盘').toBeTruthy();
  const bytes = await readFile(path!);
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  await download.saveAs('test-results/smoke-screenshot.png');

  expect(pageErrors).toEqual([]);
});
