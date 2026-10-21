import * as THREE from 'three';
import type { BuildingDefinition } from '../domain';
import type { ModelLibrary } from './models';
export function lighting(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight('#dfe9ef', '#b49a7a', 1.7));
  const sun = new THREE.DirectionalLight('#ffe2bd', 3.2);
  sun.position.set(-4, 9, 7);
  scene.add(sun);
}
export function thumbnails(
  library: ModelLibrary,
  catalog: BuildingDefinition[],
  size = 128,
  uniformCamera = false,
): Map<string, string> {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  lighting(scene);
  const result = new Map<string, string>();
  for (const definition of catalog) {
    const model = library.create(definition.id);
    scene.add(model);
    const bounds = new THREE.Box3().setFromObject(model),
      center = bounds.getCenter(new THREE.Vector3()),
      extent = bounds.getSize(new THREE.Vector3());
    const span = uniformCamera ? 4.8 : Math.max(extent.x, extent.z, extent.y) * 1.12 + 0.2;
    if (uniformCamera) center.set(0, 1.4, 0);
    const camera = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.1, 30);
    camera.position.copy(center).add(new THREE.Vector3(3.5, 2.7, 4));
    camera.lookAt(center);
    renderer.render(scene, camera);
    result.set(definition.id, renderer.domElement.toDataURL('image/png'));
    scene.remove(model);
  }
  renderer.dispose();
  return result;
}
export function showContactSheet(library: ModelLibrary, catalog: BuildingDefinition[]): void {
  const small = thumbnails(library, catalog, 128, true),
    large = thumbnails(library, catalog, 512, true);
  document.body.classList.add('contact-page');
  const app = document.querySelector('#app');
  if (!app) return;
  app.replaceChildren();
  const title = document.createElement('h1');
  title.textContent = 'The neighborhood collection';
  app.append(title);
  const subtitle = document.createElement('p');
  subtitle.textContent =
    'Identical camera, light, and material. Gameplay previews at 128 px, alongside 512 px details.';
  app.append(subtitle);
  const grid = document.createElement('div');
  grid.className = 'contact-grid';
  for (const def of catalog) {
    const card = document.createElement('article');
    const heading = document.createElement('h2');
    heading.textContent = def.name;
    card.append(heading);
    for (const [map, size] of [
      [small, 128],
      [large, 512],
    ] satisfies [Map<string, string>, number][]) {
      const img = document.createElement('img');
      img.src = map.get(def.id) ?? '';
      img.width = size;
      img.height = size;
      img.alt = `${def.name}, ${size} pixel model render`;
      card.append(img);
    }
    grid.append(card);
  }
  app.append(grid);
}
