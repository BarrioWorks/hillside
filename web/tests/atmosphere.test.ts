import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { REGIONS } from '../src/domain';
import {
  ENVIRONMENT_CANDIDATES,
  LIGHTING_PRESETS,
  linearToOklab,
  parseEnvironmentQuery,
  resolveEnvironment,
} from '../src/render/environment';
import { Lighting } from '../src/render/lighting';

const BOARD = new THREE.Vector3(3, 0.5, -2);
const RADIUS = 14;

function lighting(query: string) {
  const renderer = {
    outputColorSpace: '',
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 0,
  } as unknown as THREE.WebGLRenderer;
  const scene = new THREE.Scene();
  const lights = new Lighting(scene, renderer, BOARD, RADIUS, 256, parseEnvironmentQuery(query));
  return { scene, lights };
}

/** An orthographic camera looking at `target` from `distance` away, as `World.setView` places it. */
function camera(distance: number, azimuth: number, polar: number, target = BOARD) {
  const view = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 400);
  view.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(distance, polar, azimuth));
  view.lookAt(target);
  view.updateMatrixWorld();
  return view;
}

/** three.js linear fog: smoothstep over view depth. */
function fogAt(fog: THREE.Fog, view: THREE.Camera, point: THREE.Vector3): number {
  const depth = -point.clone().applyMatrix4(view.matrixWorldInverse).z;
  return THREE.MathUtils.smoothstep(depth, fog.near, fog.far);
}

/** Board samples: its center and a ring at its radius. */
const samples = [
  BOARD,
  ...Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    return BOARD.clone().add(new THREE.Vector3(Math.cos(angle) * RADIUS, 0, Math.sin(angle) * RADIUS));
  }),
];

describe('camera-relative fog', () => {
  it('gives every board point the same haze at any camera distance with the same orthographic view', () => {
    const { scene, lights } = lighting('');
    const fog = scene.fog as THREE.Fog;
    const near = camera(30, 0.52, 0.86);
    const far = camera(80, 0.52, 0.86);
    lights.fitFog(near);
    const close = samples.map((p) => fogAt(fog, near, p));
    const screen = samples.map((p) => p.clone().project(near).toArray().slice(0, 2));
    lights.fitFog(far);
    samples.forEach((p, i) => {
      expect(fogAt(fog, far, p)).toBeCloseTo(close[i] as number, 6);
      const [x, y] = p.clone().project(far).toArray();
      expect(x).toBeCloseTo(screen[i]?.[0] as number, 6);
      expect(y).toBeCloseTo(screen[i]?.[1] as number, 6);
    });
  });

  it('keeps the near half crisp and reaches only the preset haze at the far edge, for any orbit or zoom', () => {
    const { scene, lights } = lighting('?environment=balanced');
    const fog = scene.fog as THREE.Fog;
    for (const preset of LIGHTING_PRESETS) {
      lights.apply(preset);
      const haze = resolveEnvironment('balanced', 'medellin').light[preset].haze;
      for (const azimuth of [0, 1.1, 2.6, -2]) {
        const view = camera(80, azimuth, 0.86);
        view.zoom = 3;
        view.updateProjectionMatrix();
        lights.fitFog(view);
        expect(fogAt(fog, view, BOARD)).toBe(0);
        const factors = samples.map((p) => fogAt(fog, view, p));
        expect(Math.max(...factors)).toBeLessThanOrEqual(haze + 1e-3);
        expect(Math.max(...factors)).toBeGreaterThan(haze * 0.9);
        expect(haze).toBeLessThan(0.3);
      }
    }
  });

  it('ignores where the view target wanders: haze follows the board, not the camera', () => {
    const { scene, lights } = lighting('');
    const fog = scene.fog as THREE.Fog;
    const centered = camera(80, 0.52, 0.86);
    lights.fitFog(centered);
    const expected = samples.map((p) => fogAt(fog, centered, p));
    const panned = camera(45, 0.52, 0.86, BOARD.clone().add(new THREE.Vector3(4, 0, 3)));
    lights.fitFog(panned);
    for (const [i, p] of samples.entries())
      expect(fogAt(fog, panned, p)).toBeCloseTo(expected[i] as number, 6);
  });

  it('leaves legacy fog fixed in camera depth', () => {
    const { scene, lights } = lighting('?environment=legacy');
    lights.fitFog(camera(80, 0.52, 0.86));
    expect(scene.fog).toMatchObject({ near: 60, far: 140 });
  });
});

const lab = (color: THREE.Color) => linearToOklab(color.r, color.g, color.b);

describe('regional light', () => {
  const all = ENVIRONMENT_CANDIDATES.flatMap((candidate) =>
    REGIONS.flatMap((region) =>
      LIGHTING_PRESETS.map((preset) => ({
        candidate,
        region,
        preset,
        light: resolveEnvironment(candidate, region).light[preset],
      })),
    ),
  );

  it('keeps a warm principal sun over a cooler fill in every candidate, region, and preset', () => {
    for (const { light } of all) {
      const [, , sunB] = lab(light.sun);
      const [, , skyB] = lab(light.skyLight);
      expect(sunB).toBeGreaterThan(skyB + 0.01);
      expect(sunB).toBeGreaterThan(0.005);
      for (const v of [...light.sun.toArray(), ...light.skyLight.toArray(), ...light.groundLight.toArray()]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(light.exposure).toBeGreaterThanOrEqual(1);
      expect(light.exposure).toBeLessThanOrEqual(1.05);
    }
  });

  it('warms and lowers the evening sun against daylight in every region', () => {
    for (const candidate of ENVIRONMENT_CANDIDATES)
      for (const region of REGIONS) {
        const { daylight, evening } = resolveEnvironment(candidate, region).light;
        expect(lab(evening.sun)[2]).toBeGreaterThan(lab(daylight.sun)[2]);
        expect(evening.sunIntensity).toBeLessThan(daylight.sunIntensity);
        expect(lab(new THREE.Color(evening.zenith))[0]).toBeLessThan(
          lab(new THREE.Color(daylight.zenith))[0],
        );
      }
  });

  it('gives each region its own sky and light at every preset', () => {
    for (const candidate of ENVIRONMENT_CANDIDATES)
      for (const preset of LIGHTING_PRESETS) {
        const lights = REGIONS.map((region) => resolveEnvironment(candidate, region).light[preset]);
        expect(new Set(lights.map((l) => l.zenith)).size).toBe(REGIONS.length);
        expect(new Set(lights.map((l) => l.horizon)).size).toBe(REGIONS.length);
        expect(new Set(lights.map((l) => l.sun.getHexString())).size).toBe(REGIONS.length);
      }
  });

  it('keeps sky gradients subtle: zenith and horizon stay close in lightness, the evening a little less', () => {
    for (const { light, preset } of all) {
      const [zenith] = lab(new THREE.Color(light.zenith));
      const [horizon] = lab(new THREE.Color(light.horizon));
      expect(Math.abs(horizon - zenith)).toBeLessThan(preset === 'evening' ? 0.32 : 0.2);
    }
  });

  it('relights, recolors the sky, and tints fog when the preset or region changes', () => {
    const { scene, lights } = lighting('?environment=balanced');
    const seen = new Set<THREE.Texture>();
    for (const region of REGIONS)
      for (const preset of LIGHTING_PRESETS) {
        lights.setRegion(region);
        lights.apply(preset);
        const light = resolveEnvironment('balanced', region).light[preset];
        expect(lights.sun.color.equals(light.sun)).toBe(true);
        expect(lights.sky.color.equals(light.skyLight)).toBe(true);
        expect(`#${(scene.fog as THREE.Fog).color.getHexString()}`).toBe(light.horizon);
        seen.add(scene.background as THREE.Texture);
      }
    expect(seen.size).toBe(REGIONS.length * LIGHTING_PRESETS.length);
  });
});
