import { Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { type AssetState, loadLandmark } from '../src/render/assets';
import { ModelLibrary } from '../src/render/models';
import { realCore } from './core-fixture';

describe('catalog model assembly', () => {
  it('assembles all eleven models and every variation with finite bounds and compatible attributes', () => {
    const catalog = realCore().catalog();
    const library = new ModelLibrary(catalog);
    for (const def of catalog)
      for (let variation = 0; variation < 3; variation++) {
        const mesh = library.create(def.id, variation);
        const position = mesh.geometry.getAttribute('position');
        expect(position.count).toBeGreaterThan(0);
        expect(mesh.geometry.index).toBeNull();
        expect(mesh.geometry.getAttribute('color').count).toBe(position.count);
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
      b = library.create('casa', 3);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    library.dispose();
  });
  it('keeps procedural models available when an external GLB cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    try {
      const library = new ModelLibrary(realCore().catalog());
      await library.loadDetails();
      expect(library.detailsStatus).toBe('error');
      expect(library.create('tienda').geometry.getAttribute('position').count).toBeGreaterThan(0);
      const states: AssetState[] = [];
      await loadLandmark(new Scene(), (state) => states.push(state));
      expect(states.map((state) => state.status)).toEqual(['loading', 'error']);
      library.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
