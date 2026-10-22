import * as THREE from 'three';
import type { Region } from '../domain';
import {
  type EnvironmentSelection,
  environmentFor,
  type LightingPreset,
  MOODS,
  type ResolvedEnvironment,
  TONE_MAPPINGS,
} from './environment';
import { glow } from './material';

export { LIGHTING_PRESETS, type LightingPreset } from './environment';

function gradient(top: string, bottom: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const fill = context.createLinearGradient(0, 0, 0, 256);
    fill.addColorStop(0, top);
    fill.addColorStop(0.75, bottom);
    fill.addColorStop(1, bottom);
    context.fillStyle = fill;
    context.fillRect(0, 0, 2, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Legacy afternoon sky per region: small shifts around the shared gradient. */
const REGION_SKY: Record<Region, { zenith: string; horizon: string }> = {
  medellin: { zenith: '#a9c6cf', horizon: '#f2dcc0' },
  salento: { zenith: '#a4c4cc', horizon: '#eadfc6' },
  cartagena: { zenith: '#a8cbd4', horizon: '#f4d9b8' },
  bogota: { zenith: '#a3b8c6', horizon: '#e6dccd' },
};

/** Legacy fog, fixed in camera depth; environments fit theirs to the board instead. */
const LEGACY_FOG = { near: 60, far: 140 } as const;
/** Fog starts this far past the board's center, as a share of its depth extent, so the near half stays crisp. */
const FOG_START = 0.15;

/**
 * Owns the sun, sky light, background, fog, and renderer output (color space, tone mapping, exposure), so a
 * preset switch is one call and every output setting lives in one place.
 */
export class Lighting {
  readonly sun = new THREE.DirectionalLight();
  readonly sky = new THREE.HemisphereLight();
  readonly fog = new THREE.Fog('#ffffff', LEGACY_FOG.near, LEGACY_FOG.far);
  private background: THREE.CanvasTexture | null = null;

  private preset: LightingPreset = 'afternoon';
  private region: Region = 'medellin';
  private environment: ResolvedEnvironment | null;
  private backgroundKey: string | null = null;
  readonly center = new THREE.Vector3();
  private radius = 0;
  private readonly view = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    center: THREE.Vector3,
    radius: number,
    shadowSize: number,
    private readonly selection: EnvironmentSelection = { kind: 'legacy', toneMapping: 'neutral' },
  ) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = TONE_MAPPINGS[selection.toneMapping];
    this.environment = environmentFor(selection, this.region);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    scene.add(this.sun, this.sun.target, this.sky);
    scene.fog = this.fog;
    this.frame(center, radius);
  }

  /** Fits the sun's shadow volume, and the fog's reach, to the neighborhood as it grows. */
  frame(center: THREE.Vector3, radius: number): void {
    this.center.copy(center);
    this.radius = radius;
    const camera = this.sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = 1;
    camera.far = 60 + radius * 3;
    camera.updateProjectionMatrix();
    this.sun.target.position.copy(center);
    this.apply(this.preset);
  }

  /**
   * Places linear fog around the board's own view depth, so camera distance, orbit, and zoom leave the haze
   * where it was: crisp through the near half, reaching the preset's haze at the far edge. Legacy keeps its
   * fixed camera-depth fog. Cheap enough to call before every rendered frame.
   */
  fitFog(camera: THREE.Camera): void {
    if (!this.environment) return;
    camera.getWorldDirection(this.view);
    const depth = this.offset.subVectors(this.center, camera.position).dot(this.view);
    // A board of this radius spans its radius times the view's horizontal component on either side of center.
    const extent = this.radius * Math.max(0.2, Math.hypot(this.view.x, this.view.z));
    const { haze } = this.environment.light[this.preset];
    // three.js eases linear fog with smoothstep(near, far, depth); invert it so the far edge gets exactly `haze`.
    const reach = 0.5 - Math.sin(Math.asin(1 - 2 * haze) / 3);
    this.fog.near = depth + FOG_START * extent;
    this.fog.far = this.fog.near + ((1 - FOG_START) * extent) / reach;
  }

  apply(preset: LightingPreset): void {
    this.preset = preset;
    const mood = MOODS[preset];
    const distance = 60;
    this.sun.position.set(
      this.center.x + Math.cos(mood.azimuth) * Math.cos(mood.elevation) * distance,
      this.center.y + Math.sin(mood.elevation) * distance,
      this.center.z + Math.sin(mood.azimuth) * Math.cos(mood.elevation) * distance,
    );
    glow.value = mood.windows;
    const light = this.environment?.light[preset];
    if (light) {
      this.sun.color.copy(light.sun);
      this.sun.intensity = light.sunIntensity;
      this.sky.color.copy(light.skyLight);
      this.sky.groundColor.copy(light.groundLight);
      this.sky.intensity = light.ambient;
      this.renderer.toneMappingExposure = light.exposure;
      this.setSky(light);
      return;
    }
    this.sun.color.set(mood.sun);
    this.sun.intensity = mood.sunIntensity;
    this.sky.color.set(mood.sky);
    this.sky.groundColor.set(mood.ground);
    this.sky.intensity = mood.ambient;
    this.renderer.toneMappingExposure = mood.exposure;
    this.fog.near = LEGACY_FOG.near;
    this.fog.far = LEGACY_FOG.far;
    // The legacy afternoon sky takes the region's own zenith and horizon; daylight and evening stay shared.
    this.setSky(preset === 'afternoon' ? REGION_SKY[this.region] : mood);
  }

  private setSky({ zenith, horizon }: { zenith: string; horizon: string }): void {
    const key = `${zenith}/${horizon}`;
    if (this.backgroundKey !== key) {
      this.background?.dispose();
      this.background = gradient(zenith, horizon);
      this.backgroundKey = key;
      this.scene.background = this.background;
    }
    this.fog.color.set(horizon);
  }

  setRegion(region: Region): void {
    if (region === this.region) return;
    this.region = region;
    this.environment = environmentFor(this.selection, region);
    this.apply(this.preset);
  }

  dispose(): void {
    this.background?.dispose();
  }
}
