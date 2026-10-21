import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseURL = process.env.BARRIO_URL ?? 'http://127.0.0.1:5173';
const out = process.argv[2] ?? 'docs/screenshots/after';
const only = process.argv[3]?.split(',');
await mkdir(out, { recursive: true });

function buildNeighborhood(size) {
  const api = window.__barrio;
  api.command({ type: 'reset', seed: 2026 });
  for (const s of api.snapshot().structures) api.command({ type: 'remove', x: s.x, z: s.z });
  const snapshot = api.snapshot();
  const height = new Map(snapshot.cells.map((c) => [`${c.x},${c.z}`, c.height]));
  const h = (x, z) => height.get(`${x},${z}`);
  const place = (kind, x, z, rotations) => {
    for (const rotation of rotations)
      if (api.preview(kind, x, z, rotation).valid) return api.command({ type: 'place', kind, x, z, rotation });
    return false;
  };
  const street = (x0, x1, z0, z1) => {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const here = h(x, z);
        if (x0 === x1 && h(x, z - 1) === here + 1 && h(x, z + 1) === here) place('stairs', x, z, [2]);
        else if (z0 === z1 && h(x + 1, z) === here + 1 && h(x - 1, z) === here) place('stairs', x, z, [1]);
        else if (z0 === z1 && h(x - 1, z) === here + 1 && h(x + 1, z) === here) place('stairs', x, z, [3]);
        else place('path', x, z, [0]);
      }
  };
  const lots = (cells, kinds) => {
    let i = 0;
    for (const [x, z, facing] of cells) {
      const kind = kinds[i % kinds.length];
      const order = [facing, (facing + 1) % 4, (facing + 3) % 4, (facing + 2) % 4];
      if (place(kind, x, z, order)) i++;
    }
    return i;
  };
  if (size === 'single') {
    place('casa', 15, 15, [0]);
    return;
  }
  if (size === 'six') {
    street(12, 19, 17, 17);
    lots(
      [
        [13, 16, 0],
        [14, 16, 0],
        [16, 15, 0],
        [18, 16, 0],
        [13, 18, 2],
        [16, 18, 2],
      ],
      ['casa', 'tienda', 'esquina', 'torre', 'terraza', 'taller'],
    );
    place('tree', 19, 18, [0]);
    return;
  }
  street(15, 15, 4, 28);
  street(6, 26, 11, 11);
  street(6, 26, 22, 22);
  const kinds = ['casa', 'esquina', 'tienda', 'casa', 'torre', 'terraza', 'casa', 'taller', 'esquina', 'casa'];
  const cells = [];
  for (let z = 5; z <= 28; z++)
    for (let x = 6; x <= 26; x++) {
      if (x === 15 || z === 11 || z === 22) continue;
      const facing = z === 10 || z === 21 ? 0 : z === 12 || z === 23 ? 2 : x === 14 ? 1 : x === 16 ? 3 : 0;
      cells.push([x, z, facing]);
    }
  cells.sort((a, b) => Math.abs(a[0] - 15) + Math.abs(a[1] - 16) - (Math.abs(b[0] - 15) + Math.abs(b[1] - 16)));
  const near = cells.filter(([x, z]) => [10, 12, 21, 23].includes(z) || x === 14 || x === 16);
  lots(near.slice(0, size === 'dense' ? 60 : 200), kinds);
  for (const [x, z] of [
    [14, 9],
    [16, 13],
    [20, 13],
    [10, 20],
    [17, 24],
    [12, 24],
  ])
    place('tree', x, z, [0]);
  for (const [x, z] of [
    [16, 9],
    [13, 20],
  ])
    place('planter', x, z, [0]);
  place('bench', 17, 13, [2]);
}

const center = [16, 1.2, 16];
const shots = [
  { name: '01-single-house', scene: 'single', view: { zoom: 3.4, target: [15.5, 1.5, 15.5] }, ui: false },
  { name: '02-six-buildings', scene: 'six', view: { zoom: 2.2, target: [16, 1.8, 17] }, ui: false },
  { name: '03-dense-hillside', scene: 'dense', view: { zoom: 1.35, target: center }, ui: false },
  { name: '04-full-diorama', scene: 'dense', view: { zoom: 0.68, target: center }, ui: false },
  { name: '05-gameplay-ui', scene: 'dense', view: { zoom: 1 }, ui: true, hover: [19, 18] },
  { name: '06-reverse-angle', scene: 'dense', view: { zoom: 1.35, azimuth: -0.9, target: center }, ui: false },
  { name: '07-low-angle', scene: 'dense', view: { zoom: 1.8, polar: 1.15, target: center }, ui: false },
  { name: '08-mobile', scene: 'dense', view: {}, ui: true, mobile: true },
].filter((shot) => !only || only.includes(shot.name));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BARRIO_BROWSER_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
for (const shot of shots) {
  const page = await browser.newPage(
    shot.mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  );
  page.on('pageerror', (error) => errors.push(`${shot.name}: ${error.message}`));
  await page.goto(`${baseURL}/?quality=high&capture`);
  await page.waitForFunction(() => window.__barrio?.ready, null, { timeout: 60000 });
  await page.evaluate(buildNeighborhood, shot.scene);
  await page.evaluate((view) => window.__barrio.view(view), shot.view);
  if (!shot.ui)
    await page.addStyleTag({ content: '#app > :not(canvas){display:none!important}' });
  if (shot.hover) {
    const point = await page.evaluate(([x, z]) => window.__barrio.cellToScreen(x, z), shot.hover);
    await page.mouse.move(point.x, point.y);
  }
  await page.evaluate(() => window.__barrio.updateShadows());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${shot.name}.png` });
  const metrics = await page.evaluate(() => window.__barrio.metrics());
  await writeFile(`${out}/${shot.name}.json`, JSON.stringify(metrics, null, 2));
  console.log(shot.name, `structures=${metrics.structures}`, `draws=${metrics.drawCalls}`, `tris=${metrics.triangles}`);
  await page.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
