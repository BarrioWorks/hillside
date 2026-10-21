import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release } from 'node:os';
import { chromium } from '@playwright/test';

// Measures representative Classic scenes: the opening tile and runs grown by 10, 20 and 30 placements. For each scene it records render
// cost per frame (?profile: renderer.render plus a one-pixel readPixels), draw calls, triangles, renderer
// memory counts, scene build time, and the latency of a real placement (Rust rules plus scene update).
const baseURL = process.env.BARRIO_URL ?? 'http://127.0.0.1:4173';
const quality = process.env.BARRIO_QUALITY ?? 'low';
const sampleMs = Number(process.env.BARRIO_SAMPLE_MS ?? 8000);
const scenes = [0, 10, 20, 30];
const host = {
  platform: platform(),
  release: release(),
  cpu: cpus()[0]?.model ?? 'unknown',
  logicalCPUs: cpus().length,
  loadAverageAtStart: loadavg(),
};
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BARRIO_BROWSER_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const failures = [];
const results = [];
try {
  for (const grow of scenes) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => failures.push(error.message));
    const loadStart = performance.now();
    await page.goto(`${baseURL}/?profile&quality=${quality}&seed=2026`);
    await page.waitForFunction(
      () => window.__barrio?.ready && window.__barrio.metrics().renderFrames > 0,
      null,
      {
        timeout: 90000,
      },
    );
    const readyMilliseconds = performance.now() - loadStart;
    const growth = grow ? await page.evaluate((count) => window.__barrio.autoplay(count), grow) : null;
    const build = await page.evaluate(() => {
      window.__barrio.home();
      return window.__barrio.metrics().reconcileMs;
    });
    await page.evaluate(() => window.__barrio.renderContinuously(true));
    await page.waitForTimeout(sampleMs);
    const metrics = await page.evaluate(() => ({ ...window.__barrio.metrics(), loadAverage: null }));
    await page.evaluate(() => window.__barrio.renderContinuously(false));
    // Placement latency: preview the best spot, place it, and time until the scene has reconciled.
    const latency = await page.evaluate(() => {
      const api = window.__barrio;
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const snapshot = api.snapshot();
        if (snapshot.finished) break;
        let move = null;
        const previewStart = performance.now();
        for (const cell of snapshot.frontier)
          for (let rotation = 0; rotation < 6 && !move; rotation++)
            if (api.preview(cell.q, cell.r, rotation).valid) move = { ...cell, rotation };
        const previewMs = performance.now() - previewStart;
        if (!move) break;
        // The real game previews one rotation while hovering; this times one hover preview.
        const hoverStart = performance.now();
        api.preview(move.q, move.r, move.rotation);
        const hoverMs = performance.now() - hoverStart;
        const start = performance.now();
        api.command({ type: 'place', q: move.q, r: move.r, rotation: move.rotation });
        samples.push({ placeMs: performance.now() - start, hoverMs, sweepMs: previewMs });
      }
      return samples;
    });
    // Ten new games on the same seed, regrown to the same size, should not grow renderer memory.
    const memory = await page.evaluate(async (count) => {
      const api = window.__barrio;
      const read = () => {
        const { geometries, textures, allocatedBatchCount, cachedGeometries } = api.metrics();
        return { geometries, textures, allocatedBatchCount, cachedGeometries };
      };
      const seed = api.snapshot().seed;
      const regrow = async () => {
        api.command({ type: 'newGame', seed });
        await new Promise((done) => setTimeout(done, 300));
        if (count) api.command({ type: 'autoplay', count });
        await new Promise((done) => setTimeout(done, 300));
      };
      // The first regrow may meet new tile layouts and fill the geometry cache; leaks show after that.
      await regrow();
      const before = read();
      for (let i = 0; i < 10; i++) {
        await regrow();
      }
      return { before, afterTenRegrownRuns: read() };
    }, grow + 5);
    const median = (values) =>
      values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
    const result = {
      grownBy: grow,
      tiles: metrics.tiles,
      readyMilliseconds,
      autoplayMilliseconds: growth?.milliseconds ?? 0,
      sceneBuildMilliseconds: build,
      renderMedianMilliseconds: metrics.renderMs,
      renderSamples: metrics.renderSamples,
      drawCalls: metrics.drawCalls,
      triangles: metrics.triangles,
      geometries: metrics.geometries,
      textures: metrics.textures,
      groundTriangles: metrics.groundTriangles,
      tileParts: metrics.tileParts,
      batchCount: metrics.batchCount,
      placementMedianMilliseconds: median(latency.map((sample) => sample.placeMs)),
      hoverPreviewMedianMilliseconds: median(latency.map((sample) => sample.hoverMs)),
      frontierSweepMedianMilliseconds: median(latency.map((sample) => sample.sweepMs)),
      memory,
      loadAverage: loadavg(),
    };
    results.push(result);
    console.info(
      `${String(result.tiles).padStart(3)} tiles  render ${Math.round(result.renderMedianMilliseconds)} ms  draws ${result.drawCalls}  tris ${result.triangles}  place ${result.placementMedianMilliseconds?.toFixed(1) ?? 'n/a (deck empty)'} ms  load ${result.loadAverage[0].toFixed(1)}`,
    );
    await page.close();
  }
  assert.deepEqual(failures, [], 'Benchmark pages must not throw.');
  const output = {
    recordedAt: new Date().toISOString(),
    browserVersion: browser.version(),
    host,
    quality,
    mode: 'explicit SwiftShader software rendering, 1440x900, pixel ratio 1',
    method:
      'Per scene: load /?profile&seed=2026, grow with the greedy autoplay command (a run holds at most the 30-tile deck plus rewards), frame the neighborhood, render continuously for the sample window, and take the median of renderer.render plus a one-pixel readPixels. Placement latency times the place command through Rust validation, snapshot parsing, and the synchronous scene reconcile; rendering of the next frame is excluded.',
    limitations:
      'Software rasterization on a GPU-less host. Use for A/B comparison only; it does not establish desktop or mobile frame rates.',
    results,
  };
  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile(
    process.env.BARRIO_BENCHMARK_OUT ?? `docs/benchmarks/hex-scenes-${quality}.json`,
    `${JSON.stringify(output, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
