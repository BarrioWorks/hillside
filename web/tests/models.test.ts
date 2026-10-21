import { describe, expect, it } from 'vitest';
import { ModelLibrary } from '../src/render/models';
import { realCore } from './core-fixture';

describe('catalog model assembly', () => {
  it('assembles all eleven models and every variation with finite bounds and compatible attributes', () => {
    const catalog = realCore().catalog();
    const library = new ModelLibrary(catalog);
    for (const def of catalog)
      for (let variation = 0; variation < 16; variation++) {
        const mesh = library.create(def.id, variation);
        const position = mesh.geometry.getAttribute('position');
        expect(position.count).toBeGreaterThan(0);
        expect(mesh.geometry.index).toBeNull();
        expect(mesh.geometry.getAttribute('color').count).toBe(position.count);
        expect(mesh.geometry.getAttribute('surface').count).toBe(position.count);
        expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
        expect(mesh.geometry.boundingBox?.isEmpty()).toBe(false);
      }
    library.dispose();
  });
  it('gives repeated buildings visibly different approved facade and roof variants', () => {
    const library = new ModelLibrary(realCore().catalog());
    for (const kind of ['casa', 'tienda', 'torre', 'terraza', 'taller', 'esquina']) {
      const first = library.create(kind, 0),
        second = library.create(kind, 1);
      expect(Array.from(first.geometry.getAttribute('color').array)).not.toEqual(
        Array.from(second.geometry.getAttribute('color').array),
      );
      expect(first.geometry.getAttribute('position').count).not.toEqual(
        second.geometry.getAttribute('position').count,
      );
    }
    library.dispose();
  });
  it('shares geometry and materials across repeated placements', () => {
    const library = new ModelLibrary(realCore().catalog());
    const a = library.create('casa', 0),
      b = library.create('casa', 0);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    library.dispose();
  });
});
