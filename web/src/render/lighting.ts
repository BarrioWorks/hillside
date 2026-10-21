import * as THREE from 'three';
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
    sunIntensity: 2.5,
    azimuth: -1.85,
    elevation: 0.36,
    sky: '#97a6c8',
    ground: '#9a7564',
    ambient: 1.7,
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

/** Owns the sun, sky light, background, and fog so a preset switch is one call. */
export class Lighting {
  readonly sun = new THREE.DirectionalLight();
  readonly sky = new THREE.HemisphereLight();
  private background: THREE.CanvasTexture | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    readonly center: THREE.Vector3,
    radius: number,
    shadowSize: number,
  ) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const camera = this.sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = 1;
    camera.far = radius * 4;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.target.position.copy(center);
    scene.add(this.sun, this.sun.target, this.sky);
    scene.fog = new THREE.Fog('#ffffff', 60, 140);
  }

  apply(preset: LightingPreset): void {
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
    this.background?.dispose();
    this.background = gradient(mood.zenith, mood.horizon);
    this.scene.background = this.background;
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.set(mood.horizon);
    glow.value = mood.windows;
  }

  dispose(): void {
    this.background?.dispose();
  }
}
