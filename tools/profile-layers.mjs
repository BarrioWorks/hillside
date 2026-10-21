import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Attributes render cost on the stress scene by hiding or simplifying one layer at a time.
const baseURL = process.env.BARRIO_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BARRIO_BROWSER_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const variants = {
  'high tier (patterns on)': { quality: 'high', setup: () => {} },
  'low tier (patterns off)': { quality: 'low', setup: () => {} },
  'high tier, structures hidden': {
    quality: 'high',
    setup: () =>
      window.__world.scene.traverse((object) => {
        if (object.name === 'Structure batch') object.visible = false;
      }),
  },
  'high tier, unlit materials': {
    quality: 'high',
    setup: () => {
      const world = window.__world;
      const Basic = world.scene.children.find((child) => child.isMesh && child.material.isMeshBasicMaterial)
        ?.material.constructor;
      const unlit = new Basic({ vertexColors: true });
      world.scene.traverse((object) => {
        if (object.isMesh && object.material.isMeshStandardMaterial) object.material = unlit;
      });
    },
  },
};
const results = [];
for (const round of [1, 2])
  for (const [label, { quality, setup }] of Object.entries(variants)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`${baseURL}/?benchmark&profile&quality=${quality}`);
    await page.waitForFunction(() => window.__barrio?.ready && window.__barrio.metrics().renderFrames > 0);
    await page.evaluate(setup);
    await page.evaluate(() => window.__barrio.renderContinuously(true));
    await page.waitForTimeout(10000);
    const metrics = await page.evaluate(() => window.__barrio.metrics());
    results.push({ round, label, renderMs: metrics.renderMs, samples: metrics.renderSamples, triangles: metrics.triangles, drawCalls: metrics.drawCalls });
    console.info(round, label.padEnd(30), Math.round(metrics.renderMs), 'ms', metrics.renderSamples, 'samples');
    await page.close();
  }
await browser.close();
await writeFile(
  process.env.BARRIO_PROFILE_OUT ?? 'docs/benchmarks/limiter.json',
  `${JSON.stringify({ recordedAt: new Date().toISOString(), scene: '1,023-structure stress scene, 1440x900, SwiftShader', method: 'Median of renderer.render + 1-pixel readPixels per frame over 10 s of continuous rendering', results }, null, 2)}\n`,
);
