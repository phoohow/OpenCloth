import { test, expect } from '@playwright/test';

/**
 * The raster image follows the camera, and the frame submits no invalid commands.
 *
 * The second assertion is the one that matters: a render target whose depth texture is rebuilt
 * under it still draws in some drivers, but a strict implementation drops the whole submit — the
 * scene freezes while the overlay layers, drawn into another target, keep moving with the camera.
 */
test('光栅模式拖动旋转后画面跟随相机', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => {
    const text = message.text();
    if (text.includes('Uncaptured') || text.includes('Destroyed texture')) errors.push(text.slice(0, 160));
  });
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));

  await page.goto('/');
  await expect(page.locator('[data-testid="viewport-3d"]')).toBeVisible();
  // The starter project builds, simulates a first frame and settles before the camera is usable.
  await page.waitForTimeout(6000);

  const canvas = page.locator('[data-testid="viewport-3d"]');
  const orbit = async () => {
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(box.x + box.width / 2 + i * 15, box.y + box.height / 2 + i * 2);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(1200);
  };

  const still = await canvas.screenshot();
  await orbit();
  const orbited = await canvas.screenshot();

  expect(orbited.equals(still), '拖动旋转后画面没有变化').toBe(false);
  expect(errors, `WebGPU 校验错误：\n${errors.slice(0, 3).join('\n')}`).toEqual([]);
});
