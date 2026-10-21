import * as THREE from 'three';
import type { Region } from '../domain';
import { glow } from './material';

export type LightingPreset = 'afternoon' | 'daylight' | 'evening';
export const LIGHTING_PRESETS: readonly LightingPreset[] = ['afternoon', 'daylight', 'evening'];

interface Mood {
  sun: string;
  sunIntensity: number;
  /** Sun direction as azimuth (radians, around Y) and elevation (radians above horizon). */
  azimuth: number;
  elevation: number;
  sky: string;
  ground: string;
  ambient: number;
  exposure: number;
  /** Background gradient from zenith to horizon; fog fades distant terrain toward the horizon color. */
  zenith: string;
  horizon: string;
  windows: number;
}

const MOODS: Record<LightingPreset, Mood> = {
  afternoon: {
    sun: '#ffd9a8',
    sunIntensity: 3.0,
    azimuth: -2.25,
    elevation: 0.72,
    sky: '#d6e4ec',
    ground: '#c2a98a',
    ambient: 2.0,
    exposure: 1.0,
    zenith: '#a9c6cf',
    horizon: '#f2dcc0',
    windows: 0,
  },
  daylight: {
    sun: '#fff6ea',
    sunIntensity: 3.1,
    azimuth: -2.6,
    elevation: 1.0,
    sky: '#e1ecf5',
    ground: '#c4b8a3',
    ambient: 2.3,
    exposure: 1.0,
    zenith: '#9fc3dc',
    horizon: '#e9f0ef',
    windows: 0,
  },
  evening: {
    sun: '#ffa66e',
    sunIntensity: 2.6,
    azimuth: -1.95,
    elevation: 0.5,
    sky: '#a7b2d0',
    ground: '#a98472',
    ambient: 2.1,
    exposure: 1.05,
    zenith: '#58648f',
    horizon: '#f0a982',
    windows: 1.6,
  },
};

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

/** Afternoon sky per region, from the art direction review: small shifts around the shared gradient. */
const REGION_SKY: Record<Region, { zenith: string; horizon: string }> = {
  medellin: { zenith: '#a9c6cf', horizon: '#f2dcc0' },
  salento: { zenith: '#a4c4cc', horizon: '#eadfc6' },
  cartagena: { zenith: '#a8cbd4', horizon: '#f4d9b8' },
  bogota: { zenith: '#a3b8c6', horizon: '#e6dccd' },
};

/** Owns the sun, sky light, background, and fog so a preset switch is one call. */
export class Lighting {
  readonly sun = new THREE.DirectionalLight();
  readonly sky = new THREE.HemisphereLight();
  private background: THREE.CanvasTexture | null = null;

  private preset: LightingPreset = 'afternoon';
  private region: Region = 'medellin';
  private backgroundPreset: string | null = null;
  readonly center = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    center: THREE.Vector3,
    radius: number,
    shadowSize: number,
  ) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    scene.add(this.sun, this.sun.target, this.sky);
    scene.fog = new THREE.Fog('#ffffff', 60, 140);
    this.frame(center, radius);
  }

  /** Fits the sun's shadow volume to the neighborhood as it grows. */
  frame(center: THREE.Vector3, radius: number): void {
    this.center.copy(center);
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

  apply(preset: LightingPreset): void {
    this.preset = preset;
    const mood = MOODS[preset];
    const distance = 60;
    this.sun.color.set(mood.sun);
    this.sun.intensity = mood.sunIntensity;
    this.sun.position.set(
      this.center.x + Math.cos(mood.azimuth) * Math.cos(mood.elevation) * distance,
      this.center.y + Math.sin(mood.elevation) * distance,
      this.center.z + Math.sin(mood.azimuth) * Math.cos(mood.elevation) * distance,
    );
    this.sky.color.set(mood.sky);
    this.sky.groundColor.set(mood.ground);
    this.sky.intensity = mood.ambient;
    this.renderer.toneMappingExposure = mood.exposure;
    // The afternoon sky takes the region's own zenith and horizon; daylight and evening stay shared.
    const sky = preset === 'afternoon' ? REGION_SKY[this.region] : mood;
    const backgroundKey = `${preset}/${preset === 'afternoon' ? this.region : ''}`;
    if (this.backgroundPreset !== backgroundKey) {
      this.background?.dispose();
      this.background = gradient(sky.zenith, sky.horizon);
      this.backgroundPreset = backgroundKey;
      this.scene.background = this.background;
    }
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.set(sky.horizon);
    glow.value = mood.windows;
  }

  setRegion(region: Region): void {
    if (region === this.region) return;
    this.region = region;
    this.apply(this.preset);
  }

  dispose(): void {
    this.background?.dispose();
  }
}
