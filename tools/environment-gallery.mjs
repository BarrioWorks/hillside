import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseURL = process.env.BARRIO_URL ?? 'http://localhost:5174';
const out = 'docs/screenshots/environment/gallery';
const threeURL = `/@fs${resolve('node_modules/.vite/deps/three.js')}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BARRIO_BROWSER_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${baseURL}/?seed=909352&profile&quality=high&environment=balanced`);
  await page.waitForFunction(() => window.__barrio?.ready, null, { timeout: 60000 });
  const models = await page.evaluate(async (threeURL) => {
    const { broadleaf, flowering } = await import('/src/render/models.ts');
    const THREE = await import(threeURL);
    const w = window.__world;
    for (const child of [...w.scene.children])
      if (!child.isLight && child !== w.lights.sun.target) w.scene.remove(child);
    const families = ['rounded', 'spreading', 'andean', 'woodland', 'flowering'];
    const meshes = families.map((family, i) => {
      const geometry = family === 'flowering' ? flowering('gold', 1) : broadleaf(family, 1);
      const mesh = new THREE.Mesh(geometry, w.ground.material);
      mesh.position.set((i - 2) * 2.6, 0, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.family = family;
      w.scene.add(mesh);
      return mesh;
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 6).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#a4b77c', roughness: 1 }),
    );
    floor.receiveShadow = true;
    w.scene.add(floor);
    w.lights.frame(new THREE.Vector3(0, 0.5, 0), 10);
    w.setView({ target: [0, 0.6, 0], zoom: 1.8, azimuth: 0, polar: 0.98 });
    w.invalidateShadows();
    window.__gallery = { meshes, floor };
    return meshes.map((mesh) => {
      mesh.geometry.computeBoundingBox();
      return {
        family: mesh.userData.family,
        position: mesh.position.toArray(),
        bounds: {
          min: mesh.geometry.boundingBox.min.toArray(),
          max: mesh.geometry.boundingBox.max.toArray(),
        },
        triangles: mesh.geometry.getAttribute('position').count / 3,
      };
    });
  }, threeURL);
  await page.addStyleTag({ content: '#app > :not(canvas){display:none!important}' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/tree-families-color.png` });
  await page.evaluate(async (threeURL) => {
    const THREE = await import(threeURL);
    const gallery = window.__gallery;
    const ink = new THREE.MeshBasicMaterial({ color: '#17212f' });
    for (const mesh of gallery.meshes) mesh.material = ink;
    gallery.floor.material = new THREE.MeshBasicMaterial({ color: '#e2e6d6' });
    window.__world.invalidateShadows();
  }, threeURL);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/tree-families-monochrome.png` });
  await writeFile(
    `${out}/tree-families.json`,
    JSON.stringify(
      {
        source: 'Actual game procedural tree generators and World renderer, isolated diagnostic gallery.',
        order:
          'Left to right: compact rounded, broad canopy, tall Andean, irregular woodland, flowering accent.',
        seed: 909352,
        variant: 1,
        models,
        errors,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
