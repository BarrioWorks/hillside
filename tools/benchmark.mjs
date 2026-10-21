import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release } from 'node:os';
import { chromium } from '@playwright/test';

const baseURL = process.env.BARRIO_URL ?? 'http://127.0.0.1:4173';
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
const [viewWidth, viewHeight] = (process.env.BARRIO_VIEWPORT ?? '1440x900').split('x').map(Number);
const page = await browser.newPage({
  viewport: { width: viewWidth, height: viewHeight },
  deviceScaleFactor: 1,
});
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
page.on('requestfailed', (request) => failures.push(`${request.url()} ${request.failure()?.errorText}`));
page.on('response', (response) => {
  if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
});

try {
  const loadStart = performance.now();
  await page.goto(
    `${baseURL}/?benchmark&profile${process.env.BARRIO_QUALITY ? `&quality=${process.env.BARRIO_QUALITY}` : ''}`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForFunction(() => window.__barrio?.ready === true);
  await page.waitForFunction(() => window.__barrio.metrics().renderFrames > 0);
  const readyMilliseconds = performance.now() - loadStart;
  const save = await page.evaluate(() => {
    const stored = sessionStorage.getItem('barrio.autosave.v1');
    if (!stored) throw new Error('The benchmark did not produce a save.');
    const data = JSON.parse(stored);
    const original = data.structures;
    data.structures = Array.from(
      { length: 500 },
      (_, i) => original[Math.floor((i * original.length) / 500)],
    );
    return JSON.stringify(data);
  });
  const updateStart = performance.now();
  await page
    .locator('#import-file')
    .setInputFiles({ name: 'benchmark-500.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await page.waitForFunction(() => window.__barrio.snapshot().structures.length === 500);
  const importMilliseconds = performance.now() - updateStart;
  await page.waitForTimeout(3000);
  const environment = await page.evaluate(() => {
    const canvas = document.querySelector('#world');
    const gl = canvas.getContext('webgl2');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
      hidden: document.hidden,
    };
  });
  const runs = [];
  for (let run = 0; run < 5; run++) {
    const update = await page.evaluate(() => {
      window.__barrio.renderContinuously(true);
      return {
        structures: window.__barrio.snapshot().structures.length,
        startingFrame: window.__barrio.metrics().renderFrames,
      };
    });
    assert.equal(update.structures, 500, 'The benchmark must contain 500 actual structures.');
    const sampleStart = performance.now();
    await page.waitForTimeout(8000);
    const metrics = await page.evaluate(() => ({ ...window.__barrio.metrics(), hidden: document.hidden }));
    const elapsedMilliseconds = performance.now() - sampleStart;
    assert.equal(metrics.hidden, false);
    const renderedFrames = metrics.renderFrames - update.startingFrame;
    assert(
      metrics.continuousRendering && renderedFrames > 0 && metrics.structures === 500 && metrics.frameMs > 0,
      JSON.stringify({ update, renderedFrames, metrics }),
    );
    runs.push({
      run: run + 1,
      update,
      elapsedMilliseconds,
      renderedFrames,
      framesPerSecond: (renderedFrames * 1000) / elapsedMilliseconds,
      metrics,
    });
  }
  const memory = await page.evaluate(async () => {
    const api = window.__barrio;
    api.renderContinuously(false);
    const read = () => {
      const { geometries, textures, allocatedBatchCount } = api.metrics();
      return { geometries, textures, allocatedBatchCount };
    };
    const free = api
      .snapshot()
      .cells.filter((cell) => api.preview('casa', cell.x, cell.z).valid)
      .slice(0, 20);
    const cycle = async () => {
      for (const cell of free)
        api.command({ type: 'place', kind: 'casa', x: cell.x, z: cell.z, rotation: 0 });
      await new Promise((done) => setTimeout(done, 450));
      for (const cell of free) api.command({ type: 'remove', x: cell.x, z: cell.z });
      await new Promise((done) => setTimeout(done, 450));
    };
    await cycle();
    const after1 = read();
    for (let i = 0; i < 9; i++) await cycle();
    return { cycles: 10, placementsPerCycle: free.length, afterFirstCycle: after1, afterTenCycles: read() };
  });
  assert.deepEqual(failures, [], 'Benchmark page and network requests must succeed.');
  const ordered = runs.map((run) => run.metrics.frameMs).sort((a, b) => a - b);
  const result = {
    recordedAt: new Date().toISOString(),
    browserVersion: browser.version(),
    buildAssets: (await readdir('dist/assets')).filter((file) => /\.(js|css|wasm)$/.test(file)).sort(),
    host,
    mode: 'production build, explicit SwiftShader software rendering',
    quality: await page.evaluate(() => window.__barrio.metrics().graphics),
    method:
      'Generate the deterministic stress neighborhood, import 500 evenly distributed structures through the real save-file input, warm up for three seconds, then sample five eight-second runs with continuous rendering. Frame throughput uses actual rendered frames and host elapsed time. Frame intervals include browser scheduling, CPU work, and software rasterization.',
    limitations:
      'This is a software-renderer environment. It does not establish hardware desktop or physical mobile targets. No comparative speedup is claimed.',
    readyMilliseconds,
    importMilliseconds,
    environment,
    frameMedianMilliseconds: ordered[2],
    frameMedianRangeMilliseconds: [ordered[0], ordered.at(-1)],
    errors: failures,
    memory,
    runs,
  };
  await mkdir('docs/benchmarks', { recursive: true });
  const output = process.env.BARRIO_BENCHMARK_OUT ?? 'docs/benchmarks/software-renderer-redesign.json';
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.info(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
