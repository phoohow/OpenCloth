import { test, expect, type Page } from '@playwright/test';

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

/** Reads the live project summary through the automation facade. */
async function summary(page: Page): Promise<OpenClothSummary> {
  return page.evaluate(() => {
    const api = (window as Window & { opencloth?: OpenClothApi }).opencloth;
    if (!api) throw new Error('window.opencloth 未安装');
    return api.getSummary();
  });
}

/** Boots the app and waits for the starter project to render. */
async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('正在初始化 WebGPU 渲染器')).toBeHidden();
}

/** Draws a rectangle with the shape tool and checks undo and redo move the panel count. */
test('绘制矩形后可撤销与重做', async ({ page }) => {
  await boot(page);
  const before = await summary(page);

  await page.getByTitle('矩形 · 按住拖动绘制').click();
  await page.getByText(/矩形/).last().click();

  const box = await page.getByTestId('viewport-2d').boundingBox();
  expect(box, '2D 视口不可见').not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(cx - 60, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 60, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => (await summary(page)).panels).toBe(before.panels + 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await summary(page)).panels).toBe(before.panels);

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await summary(page)).panels).toBe(before.panels + 1);
});

/** Opens the production preview window, switches to the DXF tab and verifies the download. */
test('预览并导出 DXF 版型下载', async ({ page }) => {
  await boot(page);
  await page.getByText('生产', { exact: true }).first().click();
  await page.getByText('生产输出', { exact: true }).click();

  // The window opens on 排料图; the rail of tabs switches the previewed output.
  await expect(page.getByText('生产预览')).toBeVisible();
  await expect(page.locator('img[src^="data:image/svg+xml"]')).toBeVisible();
  await page.getByRole('button', { name: 'DXF', exact: true }).click();
  await expect(page.getByText('文本编码', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.dxf$/);
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path, 'DXF 下载未落盘').toBeTruthy();
});

/** Previews the PLM bundle in the integration dialog before saving it. */
test('协作内容先预览再导出', async ({ page }) => {
  await boot(page);
  await page.getByText('协作', { exact: true }).first().click();
  await page.getByText('外部对接', { exact: true }).click();

  // The rail opens on the PLM bundle, whose body is drawn before anything is downloaded.
  await expect(page.locator('pre')).toContainText('"format": "opencloth-plm"');
  await expect(page.getByText('文件大小', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'BOM', exact: true }).click();
  await expect(page.getByText('物料行数', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'PLM', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/PLM包\.json$/);
  expect(await download.failure()).toBeNull();
});

/** Loads a saved project through the hidden file input and checks the name reaches the store. */
test('打开工程文件替换当前工程', async ({ page }) => {
  await boot(page);
  const json = await page.evaluate(() => {
    const api = (window as Window & { opencloth?: OpenClothApi }).opencloth;
    if (!api) throw new Error('window.opencloth 未安装');
    return api.getProjectJson();
  });
  const project = JSON.parse(json) as { meta: { name: string } };
  project.meta.name = 'E2E 载入工程';

  await page.locator('input[accept=".ocproj"]').setInputFiles({
    name: 'e2e.ocproj',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });

  await expect.poll(async () => (await summary(page)).name).toBe('E2E 载入工程');
});
