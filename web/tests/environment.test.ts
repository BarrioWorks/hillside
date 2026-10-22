import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { REGIONS, type Snapshot } from '../src/domain';
import {
  CANOPY_FAMILIES,
  CANOPY_SHARES,
  desaturate,
  ENVIRONMENT_CANDIDATES,
  fieldFrame,
  GroundField,
  linearToOklab,
  oklabToLinear,
  parseEnvironmentQuery,
  resolveEnvironment,
  TONE_MAPPINGS,
} from '../src/render/environment';
import { groundGeometry } from '../src/render/ground';
import { center } from '../src/render/hex';
import { Lighting } from '../src/render/lighting';
import {
  createWorldMaterial,
  environmentUniformValues,
  materialFeatures,
  setEnvironment,
  setPatterns,
  worldMaterial,
} from '../src/render/material';
import { PALETTE, type PaletteName, Surface } from '../src/render/palette';
import { realCore } from './core-fixture';

const grown = (seed: number): Snapshot => realCore(seed).command({ type: 'autoplay', count: 30 }).snapshot;

function fingerprint(
  geometry: THREE.BufferGeometry,
  names = ['position', 'normal', 'color', 'surface'],
): string {
  let h = 0x811c9dc5;
  for (const name of names) {
    const bytes = new Uint8Array(new Float32Array(geometry.getAttribute(name).array).buffer);
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Color of every grass top vertex, keyed by its rounded world position. */
function topColors(geometry: THREE.BufferGeometry): Map<string, number[][]> {
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal'),
    color = geometry.getAttribute('color'),
    surface = geometry.getAttribute('surface');
  const out = new Map<string, number[][]>();
  for (let i = 0; i < position.count; i++) {
    if (surface.getX(i) !== Surface.grass || normal.getY(i) !== 1) continue;
    const at = [position.getX(i), position.getY(i), position.getZ(i)].map((v) => v.toFixed(4)).join();
    out.set(at, [...(out.get(at) ?? []), [color.getX(i), color.getY(i), color.getZ(i)]]);
  }
  return out;
}

const field = (snapshot: Snapshot, candidate: (typeof ENVIRONMENT_CANDIDATES)[number]) =>
  new GroundField(resolveEnvironment(candidate, snapshot.region), snapshot.seed);

describe('environment query', () => {
  it('defaults to Warm Painterly with Neutral tone mapping, and falls back to it for unknown values', () => {
    const warm = { kind: 'candidate', candidate: 'warm', toneMapping: 'neutral' };
    expect(parseEnvironmentQuery('')).toEqual(warm);
    expect(parseEnvironmentQuery('?environment=approved&toneMapping=filmic')).toEqual(warm);
    expect(parseEnvironmentQuery('?environment=&toneMapping=')).toEqual(warm);
    expect(parseEnvironmentQuery('?environment=LEGACY')).toEqual(warm);
    expect(parseEnvironmentQuery('?environment=constructor')).toEqual(warm);
  });

  it('keeps the legacy palette only when asked for by name', () => {
    expect(parseEnvironmentQuery('?environment=legacy')).toEqual({ kind: 'legacy', toneMapping: 'neutral' });
    expect(parseEnvironmentQuery('?environment=legacy&toneMapping=aces')).toEqual({
      kind: 'legacy',
      toneMapping: 'aces',
    });
  });

  it('opts into each candidate and tone mapper', () => {
    for (const candidate of ENVIRONMENT_CANDIDATES)
      expect(parseEnvironmentQuery(`?environment=${candidate}&toneMapping=agx`)).toEqual({
        kind: 'candidate',
        candidate,
        toneMapping: 'agx',
      });
    expect(parseEnvironmentQuery('?toneMapping=aces')).toEqual({
      kind: 'candidate',
      candidate: 'warm',
      toneMapping: 'aces',
    });
  });
});

describe('resolved environments', () => {
  const all = ENVIRONMENT_CANDIDATES.flatMap((candidate) =>
    REGIONS.map((region) => resolveEnvironment(candidate, region)),
  );

  it('produces in-gamut ground colors, bounded gains, and valid light for every candidate and region', () => {
    for (const environment of all) {
      const { meadow, lush, dry, forestFloor, patchSize, patchContrast } = environment.ground;
      for (const lab of [meadow, lush, dry, forestFloor])
        for (const v of oklabToLinear(lab)) {
          expect(v).toBeGreaterThanOrEqual(-1e-4);
          expect(v).toBeLessThanOrEqual(1 + 1e-4);
        }
      expect(patchSize).toBeGreaterThanOrEqual(4);
      expect(patchContrast).toBeGreaterThan(0);
      expect(patchContrast).toBeLessThanOrEqual(1.25);
      for (const gain of Object.values(environment.gains))
        for (const v of [gain.r, gain.g, gain.b]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThan(0.15);
          expect(v).toBeLessThan(2.5);
        }
      for (const light of Object.values(environment.light)) {
        expect(light.sunIntensity).toBeGreaterThan(1);
        expect(light.ambient).toBeGreaterThan(1);
        expect(light.zenith).toMatch(/^#[0-9a-f]{6}$/);
        expect(light.horizon).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('gives each candidate its own grass, foliage, water, stone, and light in every region', () => {
    for (const region of REGIONS) {
      const signatures = ENVIRONMENT_CANDIDATES.map((candidate) => {
        const e = resolveEnvironment(candidate, region);
        return [e.ground.meadow, e.gains.foliage, e.water.body, e.gains.stone, e.light.afternoon.sun].map(
          (v) => (v instanceof THREE.Color ? v.toArray() : [...v]).map((x) => x.toFixed(4)).join(),
        );
      });
      for (let part = 0; part < 5; part++)
        expect(new Set(signatures.map((s) => s[part])).size).toBe(ENVIRONMENT_CANDIDATES.length);
    }
  });

  /** A legacy leaf color as the material regrades it: desaturate in linear light, then apply the gain. */
  function crown(
    candidate: (typeof ENVIRONMENT_CANDIDATES)[number],
    region: (typeof REGIONS)[number],
    name: PaletteName,
  ) {
    const environment = resolveEnvironment(candidate, region);
    const color = desaturate(new THREE.Color(PALETTE[name]), environment.foliageSaturation).multiply(
      environment.gains.foliage,
    );
    const [l, a, b] = linearToOklab(color.r, color.g, color.b);
    return { l, c: Math.hypot(a, b), h: (Math.atan2(b, a) * 180) / Math.PI };
  }

  it('grades canopy apart from grass: cool sage, warm olive, depth kept between leaf tones', () => {
    const leaf = new THREE.Color(PALETTE.leaf);
    const legacyLeaf = linearToOklab(leaf.r, leaf.g, leaf.b);
    for (const region of REGIONS) {
      const [cool, balanced, warm] = (['cool', 'balanced', 'warm'] as const).map((c) =>
        crown(c, region, 'leaf'),
      );
      if (!cool || !balanced || !warm) throw new Error('missing candidate');
      expect(cool.c).toBeLessThan(balanced.c);
      expect(balanced.c).toBeLessThan(warm.c);
      expect(cool.c).toBeLessThan(Math.hypot(legacyLeaf[1], legacyLeaf[2]) * 0.75);
      expect(cool.l).toBeGreaterThan(warm.l);
      expect(warm.h).toBeLessThan(cool.h);
      for (const candidate of ENVIRONMENT_CANDIDATES) {
        const light = crown(candidate, region, 'leaf');
        const deep = crown(candidate, region, 'crownDeep');
        expect(light.l - deep.l).toBeGreaterThan(0.12);
      }
    }
  });

  it('distinguishes regions within a candidate', () => {
    for (const candidate of ENVIRONMENT_CANDIDATES)
      expect(
        new Set(REGIONS.map((region) => String(resolveEnvironment(candidate, region).ground.meadow))).size,
      ).toBe(REGIONS.length);
  });
});

describe('environment ground', () => {
  // Fingerprints of legacy ground taken before the environment system existed.
  it.each([
    [2, 'b393a347'],
    [909352, 'bd2e0257'],
    [3, '312b5ff1'],
    [4, '4b3c64b1'],
    [1, 'cd1568c6'],
  ])('leaves legacy ground byte-identical (seed %i)', (seed, expected) => {
    const snapshot = grown(seed);
    expect(fingerprint(groundGeometry(snapshot.tiles, snapshot.region))).toBe(expected);
  });

  it('recolors terrain without changing geometry', () => {
    const snapshot = grown(2);
    const legacy = groundGeometry(snapshot.tiles, snapshot.region);
    for (const candidate of ENVIRONMENT_CANDIDATES) {
      const painted = groundGeometry(snapshot.tiles, snapshot.region, field(snapshot, candidate));
      const shape = ['position', 'normal', 'surface'];
      expect(fingerprint(painted, shape)).toBe(fingerprint(legacy, shape));
      expect(fingerprint(painted, ['color'])).not.toBe(fingerprint(legacy, ['color']));
    }
  });

  it('replays the same colors for the same seed and tile set in any order', () => {
    const snapshot = grown(909352);
    const first = groundGeometry(snapshot.tiles, snapshot.region, field(snapshot, 'balanced'));
    const again = groundGeometry(snapshot.tiles, snapshot.region, field(snapshot, 'balanced'));
    expect(fingerprint(again)).toBe(fingerprint(first));
    const reversed = topColors(
      groundGeometry([...snapshot.tiles].reverse(), snapshot.region, field(snapshot, 'balanced')),
    );
    for (const [at, colors] of topColors(first))
      expect(reversed.get(at)?.[0]?.map((v) => v.toFixed(5))).toEqual(colors[0]?.map((v) => v.toFixed(5)));
  });

  it('reshuffles patches for a different seed on the same tiles', () => {
    const snapshot = grown(2);
    const other = new GroundField(resolveEnvironment('balanced', snapshot.region), snapshot.seed + 1);
    expect(fingerprint(groundGeometry(snapshot.tiles, snapshot.region, other), ['color'])).not.toBe(
      fingerprint(groundGeometry(snapshot.tiles, snapshot.region, field(snapshot, 'balanced')), ['color']),
    );
  });

  it.each(ENVIRONMENT_CANDIDATES)(
    'has no color seams where tiles share a ground position (%s)',
    (candidate) => {
      for (const seed of [2, 909352, 3, 4]) {
        const snapshot = grown(seed);
        const shared = [
          ...topColors(groundGeometry(snapshot.tiles, snapshot.region, field(snapshot, candidate))),
        ].filter(([, colors]) => colors.length > 1);
        expect(shared.length).toBeGreaterThan(50);
        for (const [, colors] of shared)
          for (const color of colors)
            for (let k = 0; k < 3; k++)
              expect(Math.abs((color[k] ?? 0) - (colors[0]?.[k] ?? 0))).toBeLessThan(1e-6);
      }
    },
  );

  it.each(ENVIRONMENT_CANDIDATES)(
    'paints broad patches: varied across the board, never sharper than a quarter hex (%s)',
    (candidate) => {
      const snapshot = grown(2);
      const ground = field(snapshot, candidate);
      const lightness: number[] = [];
      let step = 0;
      for (let x = -30; x <= 30; x += 1)
        for (let z = -30; z <= 30; z += 1) {
          const a = ground.color(x, z, 0);
          const b = ground.color(x + 0.25, z, 0);
          lightness.push(a.r + a.g + a.b);
          step = Math.max(step, Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b));
        }
      const mean = lightness.reduce((sum, v) => sum + v, 0) / lightness.length;
      const spread = Math.sqrt(lightness.reduce((sum, v) => sum + (v - mean) ** 2, 0) / lightness.length);
      const range = Math.max(...lightness) - Math.min(...lightness);
      expect(spread).toBeGreaterThan(0.02);
      // Crossing the field's full tonal range takes at least one world unit, a quarter of a hex.
      expect(step).toBeLessThan(range / 4);
    },
  );
});

describe('environment material and output', () => {
  const defines = () => (worldMaterial as THREE.Material & { defines?: Record<string, string> }).defines;

  it('adds the environment define on every quality tier and restores legacy exactly', () => {
    setPatterns(true);
    expect(defines()).toEqual({ BARRIO_PATTERNS: '' });
    setEnvironment({ environment: resolveEnvironment('warm', 'medellin'), seed: 2 });
    expect(defines()).toEqual({ BARRIO_PATTERNS: '', BARRIO_ENVIRONMENT: '' });
    setPatterns(false);
    expect(defines()).toEqual({ BARRIO_ENVIRONMENT: '' });
    setEnvironment(null);
    expect(defines()).toEqual({});
    setPatterns(true);
    expect(defines()).toEqual({ BARRIO_PATTERNS: '' });
    expect(materialFeatures()).toEqual({ patterns: true, environment: false });
  });

  function lighting(query: string) {
    const renderer = {
      outputColorSpace: '',
      toneMapping: THREE.NoToneMapping,
      toneMappingExposure: 0,
    } as unknown as THREE.WebGLRenderer;
    const lights = new Lighting(
      new THREE.Scene(),
      renderer,
      new THREE.Vector3(),
      10,
      256,
      parseEnvironmentQuery(query),
    );
    return { renderer, lights };
  }

  it('keeps legacy output: sRGB, Neutral, and per-preset exposure', () => {
    const { renderer, lights } = lighting('?environment=legacy');
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.NeutralToneMapping);
    lights.apply('evening');
    expect(renderer.toneMappingExposure).toBe(1.05);
    lights.apply('afternoon');
    expect(`#${lights.sun.color.getHexString()}`).toBe('#ffd9a8');
  });

  it('takes each preset exposure, honors the tone override, and relights every preset by region', () => {
    const { renderer, lights } = lighting('?environment=cool&toneMapping=agx');
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(TONE_MAPPINGS.agx);
    lights.apply('evening');
    expect(renderer.toneMappingExposure).toBe(1.05);
    lights.setRegion('bogota');
    expect(lights.sun.color.equals(resolveEnvironment('cool', 'bogota').light.evening.sun)).toBe(true);
    lights.apply('afternoon');
    expect(renderer.toneMappingExposure).toBe(1);
    expect(lights.sun.color.equals(resolveEnvironment('cool', 'bogota').light.afternoon.sun)).toBe(true);
    expect(`#${lights.sun.color.getHexString()}`).not.toBe('#ffd9a8');
  });
});

const oklch = (color: THREE.Color) => {
  const [l, a, b] = linearToOklab(color.r, color.g, color.b);
  return { l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
};

describe('canopy families', () => {
  it('keep a bounded, related green ramp around the middle family in every candidate and region', () => {
    for (const candidate of ENVIRONMENT_CANDIDATES)
      for (const region of REGIONS) {
        const environment = resolveEnvironment(candidate, region);
        const middle = desaturate(new THREE.Color(PALETTE.crownMid), environment.foliageSaturation).multiply(
          environment.gains.foliage,
        );
        expect(environment.canopy[CANOPY_FAMILIES.indexOf('middle')]?.toArray()).toEqual([1, 1, 1]);
        const crowns = environment.canopy.map((tint) => oklch(middle.clone().multiply(tint)));
        const base = oklch(middle);
        for (const [i, tint] of environment.canopy.entries()) {
          for (const v of tint.toArray()) {
            expect(v).toBeGreaterThan(0.4);
            expect(v).toBeLessThan(3);
          }
          const crown = crowns[i] as ReturnType<typeof oklch>;
          expect(crown.h).toBeGreaterThan(90);
          expect(crown.h).toBeLessThan(180);
          expect(Math.abs(crown.l - base.l)).toBeLessThan(0.1);
        }
        const [sage, deep, , olive] = crowns as [typeof base, typeof base, typeof base, typeof base];
        expect(deep.l).toBeLessThan(base.l);
        expect(sage.c).toBeLessThan(base.c);
        expect(olive.h).toBeLessThan(base.h);
        expect(sage.h).toBeGreaterThan(base.h);
      }
  });

  it('cover the board in the authored shares as broad, seeded, deterministic patches', () => {
    const environment = resolveEnvironment('balanced', 'salento');
    const field = new GroundField(environment, 909352);
    const totals = [0, 0, 0, 0];
    let step = 0;
    let count = 0;
    for (let x = -200; x <= 200; x += 1.7)
      for (let z = -200; z <= 200; z += 1.9) {
        const weights = field.canopy(x, z);
        expect(weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 9);
        weights.forEach((w, i) => {
          totals[i] = (totals[i] ?? 0) + w;
        });
        const next = field.canopy(x + 0.25, z);
        step = Math.max(step, ...weights.map((w, i) => Math.abs(w - (next[i] ?? 0))));
        count++;
      }
    const sum = CANOPY_FAMILIES.reduce((total, family) => total + CANOPY_SHARES[family], 0);
    for (const [i, family] of CANOPY_FAMILIES.entries())
      expect(Math.abs((totals[i] ?? 0) / count - CANOPY_SHARES[family] / sum)).toBeLessThan(0.04);
    // A crown is about a world unit across; a quarter unit never swaps its whole family.
    expect(step).toBeLessThan(0.75);
    expect(new GroundField(environment, 909352).canopy(12.3, -4.1)).toEqual(field.canopy(12.3, -4.1));
    const other = new GroundField(environment, 909353);
    const differs = Array.from({ length: 40 }, (_, i) => i * 3.3).some(
      (x) => other.canopy(x, x * 0.7).join() !== field.canopy(x, x * 0.7).join(),
    );
    expect(differs).toBe(true);
  });
});

describe('water family', () => {
  it('is a coordinated turquoise family: deep pools below the body, pale highlights and edges above', () => {
    for (const candidate of ENVIRONMENT_CANDIDATES)
      for (const region of REGIONS) {
        const { water, ground } = resolveEnvironment(candidate, region);
        const [body, deep, highlight, edge] = [water.body, water.deep, water.highlight, water.edge].map(
          oklch,
        ) as [
          ReturnType<typeof oklch>,
          ReturnType<typeof oklch>,
          ReturnType<typeof oklch>,
          ReturnType<typeof oklch>,
        ];
        for (const color of [body, deep, highlight, edge]) {
          expect(color.h).toBeGreaterThan(165);
          expect(color.h).toBeLessThan(230);
        }
        expect(deep.l).toBeLessThan(body.l);
        expect(highlight.l).toBeGreaterThan(body.l);
        expect(edge.l).toBeGreaterThan(highlight.l);
        expect(highlight.c).toBeLessThan(body.c);
        // Water stays distinct from the meadow it runs through.
        expect(
          Math.abs(body.h - (Math.atan2(ground.meadow[2], ground.meadow[1]) * 180) / Math.PI),
        ).toBeGreaterThan(40);
      }
  });
});

describe('forest floor', () => {
  const field = new GroundField(resolveEnvironment('balanced', 'medellin'), 2);
  const at = (q: number, r: number) => center(q, r);

  it('fills a forest tile, fades within its neighbor, and merges adjacent forests into one mass', () => {
    const single = [at(0, 0)];
    expect(field.forestCover(single[0]?.x ?? 0, single[0]?.z ?? 0, single)).toBeGreaterThan(0.95);
    const neighbor = at(1, 0);
    expect(field.forestCover(neighbor.x, neighbor.z, single)).toBe(0);
    const pair = [at(0, 0), at(1, 0)];
    const middle = { x: ((pair[0]?.x ?? 0) + neighbor.x) / 2, z: ((pair[0]?.z ?? 0) + neighbor.z) / 2 };
    expect(field.forestCover(middle.x, middle.z, pair)).toBeGreaterThan(0.85);
    expect(field.forestCover(middle.x, middle.z, single)).toBeLessThan(0.9);
  });

  it('changes gradually across a forest edge instead of stepping at the hex outline', () => {
    const forests = [at(0, 0), at(0, 1)];
    let step = 0;
    for (let t = -6; t <= 6; t += 0.25) {
      const a = field.forestCover(t, t * 0.3, forests);
      const b = field.forestCover(t + 0.25, (t + 0.25) * 0.3, forests);
      step = Math.max(step, Math.abs(a - b));
    }
    expect(step).toBeLessThan(0.2);
  });
});

describe('environment uniforms and placement ghost', () => {
  const defines = (material: THREE.Material) =>
    (material as THREE.Material & { defines?: Record<string, string> }).defines;

  it('places the shader field from the world seed', () => {
    const environment = resolveEnvironment('balanced', 'salento');
    setEnvironment({ environment, seed: 909352 });
    const frame = fieldFrame(909352);
    const uniforms = environmentUniformValues();
    expect(uniforms.uField.value.toArray()).toEqual([
      frame.offsetX,
      frame.offsetZ,
      environment.ground.patchSize,
      environment.ground.patchContrast,
    ]);
    expect(uniforms.uFieldSalt.value).toBe(frame.salt);
    expect(uniforms.uGroundMeadow.value.toArray()).toEqual([...environment.ground.meadow]);
    expect(uniforms.uCanopy.value.map((c) => c.getHex())).toEqual(environment.canopy.map((c) => c.getHex()));
    expect(uniforms.uWaterBody.value.equals(environment.water.body)).toBe(true);
    setEnvironment({ environment, seed: 2 });
    expect(uniforms.uFieldSalt.value).toBe(fieldFrame(2).salt);
    expect(fieldFrame(2)).toEqual(fieldFrame(2));
    setEnvironment(null);
  });

  it('grades the translucent ghost with the board and follows every later feature toggle', () => {
    setPatterns(true);
    setEnvironment(null);
    const ghost = createWorldMaterial({ transparent: true, opacity: 0.85, depthWrite: true });
    expect(ghost).toMatchObject({ transparent: true, opacity: 0.85, depthWrite: true, vertexColors: true });
    expect(ghost.onBeforeCompile).toBe(worldMaterial.onBeforeCompile);
    expect(ghost.customProgramCacheKey()).toBe(worldMaterial.customProgramCacheKey());
    setEnvironment({ environment: resolveEnvironment('balanced', 'medellin'), seed: 2 });
    expect(defines(ghost)).toEqual({ BARRIO_PATTERNS: '', BARRIO_ENVIRONMENT: '' });
    setPatterns(false);
    expect(defines(ghost)).toEqual(defines(worldMaterial));
    expect(defines(ghost)).toEqual({ BARRIO_ENVIRONMENT: '' });
    ghost.dispose();
    setPatterns(true);
    expect(defines(ghost)).toEqual({ BARRIO_ENVIRONMENT: '' });
    expect(defines(worldMaterial)).toEqual({ BARRIO_PATTERNS: '', BARRIO_ENVIRONMENT: '' });
    setEnvironment(null);
  });
});
