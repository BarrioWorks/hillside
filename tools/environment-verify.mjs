import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseURL = process.env.BARRIO_URL ?? 'http://localhost:4174';
const out = 'docs/screenshots/environment/regions';
const browser = await chromium.launch({
  executablePath: process.env.BARRIO_BROWSER_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const placementHash = () => {
  let h = 2166136261;
  const hash = (value) => {
    h = Math.imul(h ^ value, 16777619);
  };
  for (const entry of window.__world.tiles.values()) {
    for (const value of entry.root.position.toArray()) hash(Math.round(value * 1e6));
    for (const mesh of entry.root.children) {
      for (const value of mesh.matrix.elements) hash(Math.round(value * 1e6));
      for (const name of ['position', 'normal', 'color', 'surface']) {
        const attribute = mesh.geometry.getAttribute(name);
        for (const byte of new Uint8Array(
          attribute.array.buffer,
          attribute.array.byteOffset,
          attribute.array.byteLength,
        ))
          hash(byte);
      }
    }
  }
  return (h >>> 0).toString(16);
};

const errors = [],
  results = [],
  compositions = new Map();
await mkdir(out, { recursive: true });
try {
  for (const seed of [909352, 2, 4, 3])
    for (const placements of [9, 59])
      for (const quality of ['high', 'low']) {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
          reducedMotion: 'reduce',
        });
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });
        await page.goto(`${baseURL}/?seed=${seed}&profile&quality=${quality}`);
        await page.waitForFunction(() => window.__barrio?.ready, null, { timeout: 60000 });
        await page.evaluate((count) => {
          const a = window.__barrio;
          a.autoplay(count);
          a.home();
          a.renderContinuously(true);
        }, placements);
        await page.waitForFunction(() => window.__barrio.metrics().renderFrames >= 3, null, {
          timeout: 60000,
        });
        await page.evaluate(() => window.__barrio.renderContinuously(false));
        const audit = await page.evaluate(() => {
          const w = window.__world,
            a = window.__barrio,
            geometries = new Set(),
            materials = new Set();
          let invalidPositions = 0,
            invalidNormals = 0,
            degenerateTriangles = 0,
            invalidSurfaces = 0,
            trianglesChecked = 0,
            bytes = 0;
          let fingerprint = 2166136261;
          const hash = (value) => {
            fingerprint = Math.imul(fingerprint ^ value, 16777619);
          };
          w.scene.traverse((o) => {
            if (o.geometry?.getAttribute('surface')) geometries.add(o.geometry);
            if (o.material)
              for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
          });
          for (const g of geometries) {
            const p = g.getAttribute('position'),
              n = g.getAttribute('normal'),
              s = g.getAttribute('surface');
            for (const name of ['position', 'normal', 'color', 'surface']) {
              const attr = g.getAttribute(name);
              if (attr) {
                bytes += attr.array.byteLength;
                for (const b of new Uint8Array(
                  attr.array.buffer,
                  attr.array.byteOffset,
                  attr.array.byteLength,
                ))
                  hash(b);
              }
            }
            if (g.index) {
              bytes += g.index.array.byteLength;
              for (const b of new Uint8Array(
                g.index.array.buffer,
                g.index.array.byteOffset,
                g.index.array.byteLength,
              ))
                hash(b);
            }
            for (let i = 0; i < p.count; i++) {
              if (![p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)) invalidPositions++;
              const length = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
              if (!Number.isFinite(length) || Math.abs(length - 1) > 0.01) invalidNormals++;
              if (!Number.isInteger(s.getX(i)) || s.getX(i) < 0 || s.getX(i) > 16) invalidSurfaces++;
            }
            const count = g.index ? g.index.count : p.count;
            for (let i = 0; i < count; i += 3) {
              const ids = [0, 1, 2].map((k) => (g.index ? g.index.getX(i + k) : i + k));
              const [a, b, c] = ids.map((k) => [p.getX(k), p.getY(k), p.getZ(k)]);
              const u = b.map((v, k) => v - a[k]),
                v = c.map((v, k) => v - a[k]);
              const area = Math.hypot(
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
              );
              if (area < 1e-10) degenerateTriangles++;
              trianglesChecked++;
            }
          }
          const snapshot = a.snapshot();
          return {
            seed: snapshot.seed,
            region: snapshot.region,
            tiles: snapshot.tiles,
            invalidPositions,
            invalidNormals,
            degenerateTriangles,
            invalidSurfaces,
            trianglesChecked,
            geometryHash: (fingerprint >>> 0).toString(16),
            geometryBufferBytes: bytes,
            materialCount: materials.size,
            metrics: a.metrics(),
          };
        });
        assert.equal(audit.metrics.environment.candidate, 'warm', 'default direction drift');
        assert(audit.trianglesChecked > 0 && audit.metrics.drawCalls > 0, 'no rendered geometry');
        assert.equal(audit.invalidPositions, 0, 'invalid geometry coordinates');
        assert.equal(audit.invalidNormals, 0, 'invalid geometry normals');
        assert.equal(audit.invalidSurfaces, 0, 'unsupported surface identifier');
        assert.equal(audit.degenerateTriangles, 0, 'degenerate triangles');
        const composition = JSON.stringify(audit.tiles),
          id = `${seed}/${placements}`;
        if (compositions.has(id))
          assert.equal(composition, compositions.get(id), 'quality changed gameplay generation');
        else compositions.set(id, composition);
        const previous = results.find((r) => r.seed === seed && r.placements === placements);
        if (previous)
          assert.equal(audit.geometryHash, previous.geometryHash, 'quality changed environmental generation');
        let seedReplay = null;
        if (seed === 909352 && placements === 9 && quality === 'high') {
          await page.evaluate(() => window.__barrio.command({ type: 'newGame', seed: 909352 }));
          const first = await page.evaluate(placementHash);
          await page.evaluate(() => window.__barrio.command({ type: 'newGame', seed: 3384 }));
          const changed = await page.evaluate(placementHash);
          assert.notEqual(first, changed, 'new seed retained vegetation from a matching starter tile');
          await page.evaluate(() => window.__barrio.command({ type: 'newGame', seed: 909352 }));
          const replay = await page.evaluate(placementHash);
          assert.equal(first, replay, 'seed replay changed actual placed geometry');
          await page.evaluate((count) => {
            window.__barrio.autoplay(count);
            window.__barrio.home();
          }, placements);
          seedReplay = { original: 909352, sameStarterSeed: 3384, first, changed, replay };
        }

        const presets =
          quality === 'high' && placements === 59 ? ['afternoon', 'daylight', 'evening'] : ['afternoon'];
        for (const preset of presets) {
          await page.evaluate((preset) => {
            window.__barrio.light(preset);
            window.__barrio.updateShadows();
          }, preset);
          await page.addStyleTag({ content: '#app > :not(canvas){display:none!important}' });
          await page.waitForTimeout(600);
          await page.screenshot({
            path: `${out}/${audit.region}-${audit.tiles.length}-${quality}-${preset}.png`,
          });
        }
        const idleBefore = await page.evaluate(() => window.__barrio.metrics().renderFrames);
        await page.waitForTimeout(250);
        const idleAfter = await page.evaluate(() => window.__barrio.metrics().renderFrames);
        assert(idleAfter - idleBefore <= 1, 'static scene continuously renders');
        const { tiles, ...record } = audit;
        results.push({
          ...record,
          placements,
          tileCount: tiles.length,
          quality,
          compositionHash: createHash('sha256').update(composition).digest('hex'),
          presets,
          seedReplay,
          idleFrames: idleAfter - idleBefore,
        });
        console.log(
          audit.region,
          tiles.length,
          quality,
          audit.geometryHash,
          `${audit.trianglesChecked} valid triangles`,
        );
        await page.close();
      }
  assert.deepEqual(errors, [], 'browser errors');
} finally {
  await mkdir('docs/verification/environment', { recursive: true });
  await writeFile('docs/verification/environment/runtime.json', JSON.stringify({ errors, results }, null, 2));
  await browser.close();
}
