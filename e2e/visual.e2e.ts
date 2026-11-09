import { test, expect } from '@playwright/test';

/** Switches trace, heatmap and wire modes; each frame must submit no invalid GPU commands. */
test('显示模式视觉清单', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => {
    const t = m.text();
    if (t.includes('Uncaptured') || t.includes('Destroyed texture')) errors.push(t.slice(0, 160));
  });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

  await page.goto('/');
  await expect(page.getByText('正在初始化 WebGPU 渲染器…')).toBeHidden();
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(7000);
  // A settled cloth lets the tracer accumulate instead of deferring every frame.
  const paused = await page.getByText('已暂停', { exact: true }).isVisible();
  if (!paused) await page.keyboard.press('Space');
  await page.waitForTimeout(1000);

  const canvas = page.locator('[data-testid="viewport-3d"]');
  const pickDisplay = async (label: string) => {
    await page.getByRole('button', { name: '显示', exact: true }).nth(0).click();
    await page.getByText(label, { exact: true }).click();
  };

  await pickDisplay('光线追踪');
  // The badge only renders while the trace gate is engaged for this pane.
  await expect(page.getByText(/光线追踪 ·/)).toBeVisible();
  await page.waitForTimeout(15000);
  await canvas.screenshot({ path: 'test-results/visual-trace.png' });

  await pickDisplay('合身热图');
  await page.waitForTimeout(2500);
  await canvas.screenshot({ path: 'test-results/visual-fit.png' });

  await pickDisplay('光栅化');
  await page.getByRole('button', { name: '线框', exact: true }).click();
  await page.getByText('叠加线框', { exact: true }).click();
  await page.waitForTimeout(1500);
  await canvas.screenshot({ path: 'test-results/visual-wire.png' });

  expect(errors, `WebGPU 校验错误：\n${errors.slice(0, 3).join('\n')}`).toEqual([]);
});

/** Heatmaps, diagnostics, picking, PIN and the GLB export all run without invalid GPU commands. */
test('热图诊断与拾取导出视觉清单', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => {
    const t = m.text();
    if (t.includes('Uncaptured') || t.includes('Destroyed texture')) errors.push(t.slice(0, 160));
  });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

  await page.goto('/');
  await expect(page.getByText('正在初始化 WebGPU 渲染器…')).toBeHidden();
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(7000);
  const paused = await page.getByText('已暂停', { exact: true }).isVisible();
  if (!paused) await page.keyboard.press('Space');
  await page.waitForTimeout(1000);

  const canvas = page.locator('[data-testid="viewport-3d"]');
  const pickDisplay = async (label: string) => {
    await page.getByRole('button', { name: '显示', exact: true }).nth(0).click();
    await page.getByText(label, { exact: true }).click();
  };

  const modes = [
    ['应变热图', 'visual-strain'],
    ['压力热图', 'visual-pressure'],
    ['UV 检查', 'visual-uv'],
    ['着色法线', 'visual-normal'],
    ['顶点法线', 'visual-vertex-normal'],
  ] as const;
  for (const [label, file] of modes) {
    await pickDisplay(label);
    await page.waitForTimeout(2000);
    await canvas.screenshot({ path: `test-results/${file}.png` });
  }
  await pickDisplay('光栅化');
  await page.waitForTimeout(1000);

  // Double-clicking the cloth selects its panel; the properties editor leaves the empty state.
  await expect(page.getByText('未选中对象', { exact: true })).toBeVisible();
  const box = (await canvas.boundingBox())!;
  // The front preset frames the whole body, so the garment chest sits in the upper quarter.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.26;
  await page.mouse.dblclick(cx, cy);
  await expect(page.getByText('未选中对象', { exact: true })).toBeHidden();

  // Alt+click on the cloth adds one PIN; the toolbar badge counts it.
  await page.keyboard.down('Alt');
  await page.mouse.click(cx, cy);
  await page.keyboard.up('Alt');
  await expect(page.getByTitle(/已打 1 个/)).toBeVisible();

  // The garment exports as GLB without the avatar.
  await page.getByText('文件', { exact: true }).first().click();
  await page.getByText('导出', { exact: true }).first().hover();
  const downloadPromise = page.waitForEvent('download');
  await page.getByText('模型：服装 GLB…', { exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.glb$/);
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path, 'GLB 下载未落盘').toBeTruthy();

  expect(errors, `WebGPU 校验错误：\n${errors.slice(0, 3).join('\n')}`).toEqual([]);
});
