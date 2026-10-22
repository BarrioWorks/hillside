import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { pedestrianScene, sceneNames, uphillFiveHouseScene } from './pedestrian-scenes.mjs';

const stage = process.env.BARRIO_PATH_STAGE ?? 'final';
const reportOnly = process.env.BARRIO_PATH_REPORT_ONLY === '1';
assert(
  stage !== 'baseline' || !existsSync('docs/verification/pedestrian/scenes.json'),
  'Historical pedestrian baseline already exists',
);
const out = `docs/screenshots/pedestrian/${stage}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BARRIO_BROWSER_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${process.env.BARRIO_URL ?? 'http://localhost:5174'}/?seed=909352&profile&quality=high`);
  await page.waitForFunction(() => window.__barrio?.ready, null, { timeout: 60000 });
  const base = await page.evaluate(() => window.__barrio.snapshot());
  await page.evaluate(() => window.__barrio.autoplay(19));
  const settlement = await page.evaluate(() => window.__barrio.snapshot());
  assert.equal(settlement.tiles.length, 20);
  let scenes;
  if (stage === 'baseline' && !reportOnly) {
    scenes = sceneNames.map((name) => ({ name, snapshot: pedestrianScene(name, base, settlement) }));
    await writeFile('docs/verification/pedestrian/scenes.json', JSON.stringify(scenes, null, 2));
  } else scenes = JSON.parse(await readFile('docs/verification/pedestrian/scenes.json', 'utf8'));
  const captures = [...scenes];
  if (stage !== 'baseline')
    captures.push({
      name: 'B-uphill-expansion',
      snapshot: uphillFiveHouseScene(scenes.find((s) => s.name === 'B-five-houses').snapshot),
    });
  await page.addStyleTag({ content: '#app > :not(canvas){display:none!important}' });
  for (const scene of captures) {
    await page.evaluate(async (s) => {
      const w = window.__world;
      w.debug(false);
      w.reconcile(s, false);
      w.home(true);
      w.setLighting('afternoon');
      await w.enableDebug();
    }, scene.snapshot);
    await page.waitForTimeout(400);
    if (stage === 'baseline')
      scene.camera = await page.evaluate(() => {
        const { camera: c, controls } = window.__world;
        return {
          position: c.position.toArray(),
          quaternion: c.quaternion.toArray(),
          target: controls.target.toArray(),
          zoom: c.zoom,
          left: c.left,
          right: c.right,
          top: c.top,
          bottom: c.bottom,
          near: c.near,
          far: c.far,
        };
      });
    else if (scene.camera)
      await page.evaluate((rig) => {
        const w = window.__world,
          c = w.camera;
        c.position.fromArray(rig.position);
        c.quaternion.fromArray(rig.quaternion);
        w.controls.target.fromArray(rig.target);
        for (const field of ['zoom', 'left', 'right', 'top', 'bottom', 'near', 'far']) c[field] = rig[field];
        w.targetZoom = rig.zoom;
        c.updateProjectionMatrix();
        w.invalidateShadows();
      }, scene.camera);
    const report = await page.evaluate(async (geometryURL) => {
      const w = window.__world;
      const { DIRECTIONS, key } = await import('/src/render/hex.ts');
      const { Surface } = await import('/src/render/palette.ts');
      const { inspectTriangles, pavementCoverage, terrainContactGaps, intersectionArea, pavingTriangles } =
        await import(geometryURL);
      const snapshot = w.snapshot;
      const byKey = new Map(snapshot.tiles.map((t) => [key(t.q, t.r), t]));
      return snapshot.tiles.map((tile) => {
        const sides = DIRECTIONS.map((d, side) => ({
          meet: tile.meets[side],
          rise: (byKey.get(key(tile.q + d.q, tile.r + d.r))?.elevation ?? tile.elevation) - tile.elevation,
        }));
        const p = w.kit.plan({ ...tile, region: snapshot.region, seed: snapshot.seed }, sides);
        const triangles = pavingTriangles(
          w.kit.compose({ ...tile, region: snapshot.region, seed: snapshot.seed }, sides),
          Surface.paving,
        );
        const waterRegions = p.pedestrian?.blocked.filter((r) => r.kind !== 'building') ?? [];
        const waterIntrusionArea = triangles.reduce(
          (sum, t) => sum + waterRegions.reduce((s, r) => s + intersectionArea(t, r.polygon), 0),
          0,
        );
        return {
          q: tile.q,
          r: tile.r,
          homes: p.homes.map((h) => ({
            side: h.side,
            group: h.group,
            public: h.public,
            door: h.door,
            connected: h.connected,
            access: h.access,
          })),
          pedestrian: p.pedestrian ?? null,
          geometry: {
            ...inspectTriangles(
              triangles,
              p.homes.map((h) => h.footprint),
            ),
            waterIntrusionArea,
            coverageGaps: p.pedestrian ? pavementCoverage(triangles, p.pedestrian) : null,
            terrainContactGaps: p.pedestrian ? terrainContactGaps(triangles, p.pedestrian) : null,
          },
        };
      });
    }, `/@fs${process.cwd()}/tools/pedestrian-geometry.mjs`);
    await writeFile(`${out}/${scene.name}-report.json`, JSON.stringify(report, null, 2));
    if (reportOnly) continue;
    await page.screenshot({ path: `${out}/${scene.name}-gameplay.png` });
    await page.evaluate(() => window.__world.debug(true));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${scene.name}-graph.png` });
    await page.evaluate(() => {
      window.__world.debug(false);
      const w = window.__world;
      w.setView({ target: [0, 0, 0], zoom: 3 });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${scene.name}-closeup.png` });
  }
  if (stage === 'baseline')
    await writeFile('docs/verification/pedestrian/scenes.json', JSON.stringify(scenes, null, 2));
  assert.deepEqual(errors, [], 'game renderer errors');
} finally {
  await browser.close();
}
