import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { chromium } from '@playwright/test';

const baseURL = process.env.BARRIO_URL ?? 'http://localhost:5174';
const beforeURL = process.env.BARRIO_BEFORE_URL ?? baseURL;
const stage = process.env.BARRIO_BENCHMARK_STAGE ?? 'm1';
assert(
  stage !== 'final' || beforeURL !== baseURL,
  'final comparison requires a separate frozen before build',
);
const repeats = Number(process.env.BARRIO_REPEATS ?? 5);
const frameCount = Number(process.env.BARRIO_FRAMES ?? 20);
assert(repeats >= 5 && frameCount >= 20);
const compositions = new Map();
const cameras = new Map();
const browser = await chromium.launch({
  executablePath: process.env.BARRIO_BROWSER_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [],
  results = [];
const checkpoint = `docs/benchmarks/environment-${stage}-runs.jsonl`;
if (process.env.BARRIO_BENCHMARK_RESUME === '1') {
  const saved = (await readFile(checkpoint, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  for (const seed of [909352, 2])
    for (const placements of [9, 59]) {
      const group = saved.filter((r) => r.seed === seed && r.placements === placements);
      const identities = new Set(group.map((r) => `${r.repeat}/${r.variant}`));
      if (
        group.length === repeats * 2 &&
        identities.size === repeats * 2 &&
        group.every((r) => r.frame.samples >= frameCount)
      )
        results.push(...group);
    }
}
const summary = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return {
    average: s.reduce((a, b) => a + b, 0) / s.length,
    median: s[Math.floor(s.length / 2)],
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
    min: s[0],
    max: s.at(-1),
    samples: s.length,
  };
};
await mkdir('docs/benchmarks', { recursive: true });
await writeFile(checkpoint, results.map((r) => `${JSON.stringify(r)}\n`).join(''));
try {
  for (const seed of [909352, 2])
    for (const placements of [9, 59])
      for (let repeat = 0; repeat < repeats; repeat++) {
        const variants = repeat % 2 ? ['balanced', 'legacy'] : ['legacy', 'balanced'];
        for (const variant of variants) {
          if (
            results.some(
              (r) =>
                r.seed === seed &&
                r.placements === placements &&
                r.repeat === repeat &&
                r.variant === variant,
            )
          )
            continue;
          const page = await browser.newPage({
            viewport: { width: 1440, height: 900 },
            deviceScaleFactor: 1,
            reducedMotion: 'reduce',
          });
          page.on('pageerror', (e) => errors.push(e.message));
          page.on('console', (m) => {
            if (m.type() === 'error') errors.push(m.text());
          });
          await page.goto(
            `${variant === 'legacy' ? beforeURL : baseURL}/?seed=${seed}&profile&quality=high&environment=${variant}`,
          );
          await page.waitForFunction(() => window.__barrio?.ready, null, { timeout: 60000 });
          await page.evaluate((count) => {
            const a = window.__barrio;
            const started = performance.now();
            a.autoplay(count);
            window.__environmentAutoplayMs = performance.now() - started;
            a.home();
            a.light('afternoon');
          }, placements);
          await page.waitForTimeout(500);
          await page.evaluate(() => window.__barrio.renderContinuously(true));
          await page.waitForFunction(() => window.__world.frameMilliseconds.length >= 4, null, {
            timeout: 60000,
          });
          await page.evaluate(() => window.__barrio.renderContinuously(true));
          await page.waitForFunction(
            (count) => window.__world.frameMilliseconds.length >= count,
            frameCount,
            { timeout: 60000 },
          );
          const data = await page.evaluate(() => ({
            metrics: window.__barrio.metrics(),
            autoplayMs: window.__environmentAutoplayMs,
            frames: window.__world.frameMilliseconds,
            renders: window.__world.renderMilliseconds,
            tiles: window.__barrio.snapshot().tiles,
            camera: {
              position: window.__world.camera.position.toArray(),
              quaternion: window.__world.camera.quaternion.toArray(),
              zoom: window.__world.camera.zoom,
              target: window.__world.controls.target.toArray(),
            },
            runtimeAssets: [...document.scripts].map((script) => script.src).filter(Boolean),
          }));
          const prior = results.find((r) => r.variant === variant);
          if (prior)
            assert.deepEqual(data.runtimeAssets, prior.runtimeAssets, 'build changed between benchmark runs');
          assert.equal(
            data.metrics.environment.candidate,
            variant,
            'candidate configuration was not applied',
          );
          assert(
            data.metrics.tiles > 0 && data.metrics.drawCalls > 0 && data.metrics.triangles > 0,
            'empty rendering',
          );
          const compositionKey = `${seed}/${placements}`;
          if (cameras.has(compositionKey)) {
            const expected = cameras.get(compositionKey);
            for (const key of Object.keys(expected)) {
              const a = Array.isArray(data.camera[key]) ? data.camera[key] : [data.camera[key]],
                b = Array.isArray(expected[key]) ? expected[key] : [expected[key]];
              assert(
                a.every((v, i) => Math.abs(v - b[i]) < 1e-7),
                'benchmark camera drift',
              );
            }
          } else cameras.set(compositionKey, data.camera);
          if (compositions.has(compositionKey))
            assert.deepEqual(
              data.tiles,
              compositions.get(compositionKey),
              'variant or repeat changed gameplay',
            );
          else compositions.set(compositionKey, data.tiles);
          results.push({
            seed,
            placements,
            repeat,
            variant,
            tiles: data.tiles.length,
            autoplayMs: data.autoplayMs,
            frame: summary(data.frames),
            render: summary(data.renders),
            metrics: data.metrics,
            camera: data.camera,
            runtimeAssets: data.runtimeAssets,
          });
          await appendFile(checkpoint, `${JSON.stringify(results.at(-1))}\n`);
          console.log(
            seed,
            placements,
            repeat,
            variant,
            `${data.tiles.length} tiles`,
            `${results.at(-1).frame.median.toFixed(1)} ms`,
          );
          await page.close();
        }
      }
  const groups = [];
  for (const seed of [909352, 2])
    for (const placements of [9, 59])
      for (const variant of ['legacy', 'balanced']) {
        const runs = results.filter(
          (r) => r.seed === seed && r.placements === placements && r.variant === variant,
        );
        groups.push({
          seed,
          placements,
          variant,
          runs: runs.length,
          medianFrameMs: summary(runs.map((r) => r.frame.median)),
          averageFrameMs: summary(runs.map((r) => r.frame.average)),
          p95FrameMs: summary(runs.map((r) => r.frame.p95)),
          drawCalls: [...new Set(runs.map((r) => r.metrics.drawCalls))],
          triangles: [...new Set(runs.map((r) => r.metrics.triangles))],
        });
      }
  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile(
    `docs/benchmarks/environment-${stage}.json`,
    JSON.stringify(
      {
        host: { cpu: cpus()[0]?.model, logicalCPUs: cpus().length, loadAverage: loadavg() },
        method: {
          stage,
          beforeURL,
          afterURL: baseURL,
          repeats,
          frameCount,
          resolution: [1440, 900],
          quality: 'high',
          warmupFrames: 4,
          alternating: true,
          limiter:
            'SwiftShader software rasterization; profiled GPU synchronization included. No hardware GPU claim.',
          gpuMemoryBytes: null,
        },
        errors,
        groups,
        results,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
