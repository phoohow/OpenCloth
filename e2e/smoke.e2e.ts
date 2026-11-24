import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test('自动着装并导出截帧', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByText('正在初始化 WebGPU 渲染器')).toBeHidden();

  const gpuMissing = await page.evaluate(() => {
    const banner = document.getElementById('webgpu-error');
    return banner !== null && getComputedStyle(banner).display !== 'none';
  });
  expect(gpuMissing, 'WebGPU 不可用，检查浏览器与显卡驱动').toBe(false);

  await expect(page.getByText('未着装', { exact: true })).toBeVisible();
  await page.getByTestId('viewport-3d').click();
  await page.keyboard.press('Control+d');
  await expect(page.getByText('模拟中')).toBeVisible();

  await page.keyboard.press('F9');
  await expect(page.getByText('3D 截帧预览')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG' }).click();
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
