import { expect, type Page, test } from '@playwright/test';

async function waitForGame(page: Page) {
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__barrio?.ready, {}, { timeout: 45000 });
  await expect(page.getByRole('button', { name: 'Build Casa', exact: true })).toBeVisible();
}
async function buildAtVisibleCell(page: Page, kind: string) {
  const candidates = await page.evaluate((kind) => {
    const api = window.__barrio;
    const snapshot = api.snapshot();
    return api
      .snapshot()
      .cells.filter((cell) => {
        const preview = api.preview(kind, cell.x, cell.z);
        const p = api.cellToScreen(cell.x, cell.z);
        return (
          typeof preview === 'object' &&
          preview !== null &&
          'valid' in preview &&
          preview.valid &&
          (kind !== 'path' ||
            snapshot.structures.some(
              (path) =>
                path.kind === 'path' &&
                Math.abs(path.x - cell.x) + Math.abs(path.z - cell.z) === 1 &&
                snapshot.cells.find((c) => c.x === path.x && c.z === path.z)?.height === cell.height,
            )) &&
          p.x > 100 &&
          p.x < innerWidth - 100 &&
          p.y > 120 &&
          p.y < innerHeight - 310
        );
      })
      .sort((a, b) => Math.abs(a.x - 12) + Math.abs(a.z - 13) - (Math.abs(b.x - 12) + Math.abs(b.z - 13)))
      .slice(0, 30)
      .map((cell) => api.cellToScreen(cell.x, cell.z));
  }, kind);
  for (const point of candidates) {
    await page.mouse.move(point.x, point.y);
    const feedback = page.locator('#placement-feedback');
    if ((await feedback.textContent()) === 'Ready to build') {
      const before = await page.evaluate(() => window.__barrio.snapshot().structures.length);
      await page.mouse.click(point.x, point.y);
      await expect
        .poll(() => page.evaluate(() => window.__barrio.snapshot().structures.length))
        .toBe(before + 1);
      return;
    }
  }
  throw new Error(`No visible valid ${kind} placement found.`);
}
test('builds, connects, removes, undoes, saves, reloads and exports a neighborhood', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await waitForGame(page);
  const before = await page.evaluate(() => window.__barrio.snapshot().structures.length);
  await buildAtVisibleCell(page, 'casa');
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Build Path', exact: true }).click();
  await buildAtVisibleCell(page, 'path');
  await page.getByRole('button', { name: 'Undo (Ctrl Z)', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__barrio.snapshot().structures.length)).toBe(before + 1);
  await page.getByRole('button', { name: 'Redo (Ctrl Shift Z)', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__barrio.snapshot().structures.length)).toBe(before + 2);
  await page.getByRole('button', { name: 'Remove a structure (X)', exact: true }).click();
  const pathPoint = await page.evaluate(() => {
    const api = window.__barrio;
    const path = api.snapshot().structures.at(-1);
    if (!path) throw new Error('No new path.');
    return api.cellToScreen(path.x, path.z);
  });
  await page.mouse.click(pathPoint.x, pathPoint.y);
  await expect.poll(() => page.evaluate(() => window.__barrio.snapshot().structures.length)).toBe(before + 1);
  await page.getByRole('button', { name: 'Undo (Ctrl Z)', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__barrio.snapshot().structures.length)).toBe(before + 2);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved');
  const saved = await page.evaluate(() => window.__barrio.snapshot().structures);
  await page.reload();
  await page.waitForFunction(() => window.__barrio?.ready);
  expect(await page.evaluate(() => window.__barrio.snapshot().structures)).toEqual(saved);
  await page.getByRole('button', { name: 'Neighborhood menu', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export a copy', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('my-barrio.json');
  const savedPath = testInfo.outputPath('neighborhood.json');
  await download.saveAs(savedPath);
  await page.getByRole('button', { name: 'Neighborhood menu', exact: true }).click();
  await page.getByRole('button', { name: 'New neighborhood', exact: true }).click();
  await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
  await page.locator('#import-file').setInputFiles(savedPath);
  await expect.poll(() => page.evaluate(() => window.__barrio.snapshot().structures)).toEqual(saved);
  await page.mouse.move(15, 90);
  await page.screenshot({ path: testInfo.outputPath('neighborhood-desktop.png') });
  expect(errors).toEqual([]);
});
test('camera dragging never places a structure and home restores the view', async ({ page }) => {
  test.setTimeout(60000);
  await waitForGame(page);
  const before = await page.evaluate(() => ({
    count: window.__barrio.snapshot().structures.length,
    point: window.__barrio.cellToScreen(16, 16),
  }));
  await page.mouse.move(600, 350);
  await page.mouse.down();
  await page.mouse.move(700, 420, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__barrio.snapshot().structures.length)).toBe(before.count);
  const moved = await page.evaluate(() => window.__barrio.cellToScreen(16, 16));
  expect(moved).not.toEqual(before.point);
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
  await expect
    .poll(async () => {
      const point = await page.evaluate(() => window.__barrio.cellToScreen(16, 16));
      return Math.hypot(point.x - before.point.x, point.y - before.point.y);
    })
    .toBeLessThan(1);
});
test('mobile palette remains reachable with local 3D thumbnails', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForGame(page);
  await expect(page.getByRole('button', { name: 'Build Casa', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Build Esquina', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Build Esquina', exact: true }).click();
  await expect(page.locator('#selection-title')).toHaveText('Esquina');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: testInfo.outputPath('neighborhood-mobile.png') });
});

async function assertTouchTargets(page: Page) {
  const tooSmall = await page.locator('button, a').evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          (rect.width < 44 || rect.height < 44)
        );
      })
      .map((button) => ({
        label: button.getAttribute('aria-label') ?? button.textContent,
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      })),
  );
  expect(tooSmall).toEqual([]);
}
for (const [name, width, height] of [
  ['desktop', 1440, 1000],
  ['mobile', 390, 844],
] satisfies [string, number, number][]) {
  test(`${name} startup matches its visual baseline and has accessible touch targets`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await waitForGame(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => {
      const metrics = window.__barrio.metrics();
      return 'renderFrames' in metrics && Number(metrics.renderFrames) > 0;
    });
    await page.mouse.move(5, 100);
    await assertTouchTargets(page);
    await expect(page).toHaveScreenshot(`${name}-startup.png`, {
      animations: 'disabled',
      maxDiffPixelRatio: 0.005,
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'Neighborhood menu', exact: true }).click();
    await assertTouchTargets(page);
  });
}
test('clicking a visible roof removes that building rather than the terrain behind it', async ({ page }) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await waitForGame(page);
  const target = await page.evaluate(() => {
    const api = window.__barrio;
    const structure = api.snapshot().structures.find((s) => s.kind === 'torre');
    if (!structure) throw new Error('The starter tower is missing.');
    return { id: structure.id, point: api.cellToScreen(structure.x, structure.z, 2.85) };
  });
  await page.getByRole('button', { name: 'Remove a structure (X)', exact: true }).click();
  await page.mouse.click(target.point.x, target.point.y);
  await expect
    .poll(() =>
      page.evaluate((id) => window.__barrio.snapshot().structures.some((s) => s.id === id), target.id),
    )
    .toBe(false);
});
test('contact sheet renders all catalog models at 128 and 512 pixels', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.goto('/?contact-sheet');
  await expect(page.getByRole('heading', { name: 'The neighborhood collection', exact: true })).toBeVisible();
  await expect(page.locator('.contact-grid article')).toHaveCount(11);
  expect(await page.locator('img[width="128"]').count()).toBe(11);
  expect(await page.locator('img[width="512"]').count()).toBe(11);
  expect(
    await page
      .locator('img')
      .evaluateAll((images) =>
        images.every(
          (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        ),
      ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('catalog-contact-sheet.png'), fullPage: true });
});

test('canceling a reopened new-neighborhood dialog preserves edits and autosave', async ({ page }) => {
  test.setTimeout(60000);
  await waitForGame(page);
  const openNew = async () => {
    await page.getByRole('button', { name: 'Neighborhood menu', exact: true }).click();
    await page.getByRole('button', { name: 'New neighborhood', exact: true }).click();
  };
  await openNew();
  await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
  await expect(page.locator('#new-dialog')).not.toBeVisible();
  await page.evaluate(() => {
    const api = window.__barrio;
    const cell = api.snapshot().cells.find((cell) => {
      const preview = api.preview('casa', cell.x, cell.z);
      return typeof preview === 'object' && preview !== null && 'valid' in preview && preview.valid;
    });
    if (!cell) throw new Error('No editable terrace.');
    if (!api.command({ type: 'place', kind: 'casa', x: cell.x, z: cell.z, rotation: 0 }))
      throw new Error('The test edit was refused.');
  });
  const before = await page.evaluate(() => ({
    snapshot: window.__barrio.snapshot(),
    autosave: localStorage.getItem('barrio.autosave.v1'),
  }));
  await openNew();
  await page.keyboard.press('Escape');
  await expect(page.locator('#new-dialog')).not.toBeVisible();
  expect(await page.evaluate(() => window.__barrio.snapshot())).toEqual(before.snapshot);
  expect(await page.evaluate(() => localStorage.getItem('barrio.autosave.v1'))).toBe(before.autosave);
});

test('mobile save retains its accessible name when its text is hidden', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForGame(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved on this device');
});
