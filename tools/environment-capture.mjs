import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseURL = process.env.BARRIO_URL ?? 'http://localhost:5174';
const stage = process.env.BARRIO_ART_STAGE ?? 'final';
const out = `docs/screenshots/environment/${stage}`;
const toneMapping = process.env.BARRIO_TONE_MAPPING;
assert(stage !== 'baseline' || !toneMapping, 'baseline uses the original renderer');
const manifestPath = process.env.BARRIO_SCENE_MANIFEST ?? 'docs/screenshots/environment/scenes.json';
assert(
  stage !== 'baseline' || !existsSync(manifestPath),
  'historical baseline already exists; refusing to overwrite it',
);
const browser = await chromium.launch({
  executablePath: process.env.BARRIO_BROWSER_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const scenes = stage === 'baseline' ? [] : JSON.parse(await readFile(manifestPath, 'utf8'));
const candidates =
  stage === 'baseline' ? ['legacy'] : (process.env.BARRIO_ART_VARIANTS ?? 'cool,warm,balanced').split(',');
const errors = [];
await mkdir(out, { recursive: true });
try {
  for (const seed of [909352, 2]) {
    for (const candidate of candidates) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.goto(
        `${baseURL}/?seed=${seed}&profile&quality=high&environment=${candidate}${toneMapping ? `&toneMapping=${toneMapping}` : ''}`,
      );
      await page.waitForFunction(() => window.__barrio?.ready, null, { timeout: 60000 });
      await page.evaluate(() => {
        window.__barrio.autoplay(29);
        window.__barrio.home();
        window.__barrio.light('afternoon');
      });
      const selected = await page.evaluate(() => window.__barrio.metrics().environment);
      if (stage !== 'baseline') {
        assert.equal(selected.candidate, candidate, 'candidate configuration was not applied');
        assert.equal(
          selected.toneMapping,
          toneMapping ?? 'neutral',
          'tone mapper configuration was not applied',
        );
        assert.equal(selected.exposure, 1, 'comparison exposure drift');
      }
      await page.addStyleTag({ content: '#app > :not(canvas){display:none!important}' });
      await page.waitForTimeout(1000);
      for (const framing of ['overview', 'closeup']) {
        const id = `${seed}-${framing}`;
        let scene = scenes.find((s) => s.id === id);
        if (stage === 'baseline') {
          if (framing === 'closeup')
            await page.evaluate(
              (seed) => window.__barrio.focus(seed === 909352 ? -0.7 : 0, seed === 909352 ? 1.6 : 0.5, 2.5),
              seed,
            );
          scene = await page.evaluate(
            ({ id, framing }) => {
              const w = window.__world,
                s = window.__barrio.snapshot(),
                c = w.camera;
              return {
                id,
                framing,
                seed: s.seed,
                region: s.region,
                placements: s.placements,
                tiles: s.tiles,
                camera: {
                  position: c.position.toArray(),
                  quaternion: c.quaternion.toArray(),
                  zoom: c.zoom,
                  left: c.left,
                  right: c.right,
                  top: c.top,
                  bottom: c.bottom,
                  near: c.near,
                  far: c.far,
                  target: w.controls.target.toArray(),
                },
                lighting: 'afternoon',
                resolution: [1440, 900],
              };
            },
            { id, framing },
          );
          scenes.push(scene);
        }
        assert(scene);
        const composition = await page.evaluate((scene) => {
          const w = window.__world,
            c = w.camera;
          c.position.fromArray(scene.camera.position);
          c.quaternion.fromArray(scene.camera.quaternion);
          c.zoom = scene.camera.zoom;
          for (const key of ['left', 'right', 'top', 'bottom', 'near', 'far']) c[key] = scene.camera[key];
          w.controls.target.fromArray(scene.camera.target);
          w.targetZoom = c.zoom;
          c.updateProjectionMatrix();
          w.invalidateShadows();
          return JSON.stringify(window.__barrio.snapshot().tiles);
        }, scene);
        assert.equal(composition, JSON.stringify(scene.tiles), 'scene composition drift');
        await page.waitForTimeout(500);
        const camera = await page.evaluate(() => {
          const w = window.__world,
            c = w.camera;
          return {
            position: c.position.toArray(),
            quaternion: c.quaternion.toArray(),
            zoom: c.zoom,
            left: c.left,
            right: c.right,
            top: c.top,
            bottom: c.bottom,
            near: c.near,
            far: c.far,
            target: w.controls.target.toArray(),
          };
        });
        for (const key of Object.keys(scene.camera)) {
          const actual = Array.isArray(camera[key]) ? camera[key] : [camera[key]],
            expected = Array.isArray(scene.camera[key]) ? scene.camera[key] : [scene.camera[key]];
          assert(
            actual.every((v, i) => Math.abs(v - expected[i]) < 1e-7),
            `camera drift: ${key}`,
          );
        }
        const name = `${id}-${candidate}${toneMapping ? `-${toneMapping}` : ''}`;
        await page.screenshot({ path: `${out}/${name}.png` });
        await page.evaluate(() => window.__barrio.renderContinuously(true));
        await page.waitForTimeout(Number(process.env.BARRIO_SAMPLE_MS ?? 3000));
        const metrics = await page.evaluate(() => {
          const w = window.__world,
            a = window.__barrio,
            frames = w.frameMilliseconds;
          const geometries = new Set(),
            materials = new Set();
          let bytes = 0;
          w.scene.traverse((o) => {
            if (o.geometry) geometries.add(o.geometry);
            if (o.material)
              for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
          });
          for (const g of geometries) {
            for (const a of Object.values(g.attributes)) bytes += a.array.byteLength;
            if (g.index) bytes += g.index.array.byteLength;
          }
          const gl = w.renderer.getContext(),
            ext = gl.getExtension('WEBGL_debug_renderer_info');
          return {
            ...a.metrics(),
            rules: a.snapshot().rules,
            runtimeAssets: [...document.scripts].map((script) => script.src).filter(Boolean),
            averageFrameMs: frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0,
            materialCount: materials.size,
            geometryBufferBytes: bytes,
            gpuMemoryBytes: null,
            gpuMemoryNote:
              'WebGL does not expose total GPU allocation; geometry buffer bytes exclude driver, textures, shadows and instance buffers.',
            adapter: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
            colorManagement: {
              output: w.renderer.outputColorSpace,
              toneMapping: w.renderer.toneMapping,
              exposure: w.renderer.toneMappingExposure,
            },
            fog: w.scene.fog
              ? { near: w.scene.fog.near, far: w.scene.fog.far, color: w.scene.fog.color.getHexString() }
              : null,
            shadow: {
              type: w.renderer.shadowMap.type,
              mapSize: w.lights.sun.shadow.mapSize.toArray(),
              bias: w.lights.sun.shadow.bias,
              normalBias: w.lights.sun.shadow.normalBias,
            },
            sun: {
              color: w.lights.sun.color.getHexString(),
              intensity: w.lights.sun.intensity,
              position: w.lights.sun.position.toArray(),
            },
            sky: {
              color: w.lights.sky.color.getHexString(),
              ground: w.lights.sky.groundColor.getHexString(),
              intensity: w.lights.sky.intensity,
            },
          };
        });
        await page.evaluate(() => window.__barrio.renderContinuously(false));
        await writeFile(
          `${out}/${name}.json`,
          JSON.stringify(
            {
              scene,
              stage,
              candidate,
              toneMapping,
              compositionHash: createHash('sha256').update(composition).digest('hex'),
              metrics,
              errors,
            },
            null,
            2,
          ),
        );
        console.log(
          name,
          `${metrics.tiles} tiles`,
          `${metrics.drawCalls} calls`,
          `${metrics.triangles} triangles`,
          `${metrics.frameSamples} samples`,
        );
      }
      await page.close();
    }
  }
  if (stage === 'baseline') await writeFile(manifestPath, JSON.stringify(scenes, null, 2));
  assert.deepEqual(errors, [], 'browser errors');
} finally {
  await browser.close();
}
