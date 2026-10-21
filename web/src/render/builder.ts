import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, type PaletteName, type SurfaceId } from './palette';

/** Height of one terrace step in world units. */
export const STEP = 0.55;
export type Paint = PaletteName | THREE.Color;
export type Side = 0 | 1 | 2 | 3;
const resolved = new Map<string, THREE.Color>();
function paint(value: Paint): THREE.Color {
  if (value instanceof THREE.Color) return value;
  let result = resolved.get(value);
  if (!result) {
    result = new THREE.Color(PALETTE[value]);
    resolved.set(value, result);
  }
  return result;
}

export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Accumulates colored, surface-tagged parts and merges them into one non-indexed geometry.
 * Vertical faces near local y = 0 are darkened (baked contact occlusion) when `groundOcclusion` is set,
 * which grounds every structure without a screen-space AO pass.
 */
export class Builder {
  private readonly parts: THREE.BufferGeometry[] = [];
  constructor(readonly groundOcclusion = true) {}

  add(geometry: THREE.BufferGeometry, color: Paint, surface: SurfaceId, matrix?: THREE.Matrix4): void {
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    if (part !== geometry) geometry.dispose();
    if (matrix) part.applyMatrix4(matrix);
    const rgb = paint(color);
    const count = part.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([rgb.r, rgb.g, rgb.b], i * 3);
    part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    part.setAttribute('surface', new THREE.BufferAttribute(new Float32Array(count).fill(surface), 1));
    part.deleteAttribute('uv');
    this.parts.push(part);
  }

  /** Adds prebuilt Builder output, keeping its colors and surfaces. */
  merge(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    this.parts.push(geometry.clone().applyMatrix4(matrix));
  }

  /** Axis-aligned box centered at (x, y, z), optionally rotated about Y around its own center. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: Paint, surface: SurfaceId, rotation = 0): void {
    const geometry = new THREE.BoxGeometry(w, h, d);
    if (rotation) geometry.rotateY(rotation);
    geometry.translate(x, y, z);
    this.add(geometry, color, surface);
  }

  /** Box whose base sits at y0. */
  block(w: number, h: number, d: number, x: number, y0: number, z: number, color: Paint, surface: SurfaceId, rotation = 0): void {
    this.box(w, h, d, x, y0 + h / 2, z, color, surface, rotation);
  }

  cylinder(radius: number, height: number, x: number, y0: number, z: number, color: Paint, surface: SurfaceId, top = radius, segments = 10): void {
    const geometry = new THREE.CylinderGeometry(top, radius, height, segments);
    geometry.translate(x, y0 + height / 2, z);
    this.add(geometry, color, surface);
  }

  blob(radius: number, x: number, y: number, z: number, color: Paint, surface: SurfaceId, squash = 1, detail = 1): void {
    const geometry = new THREE.IcosahedronGeometry(radius, detail);
    geometry.scale(1, squash, 1);
    geometry.translate(x, y, z);
    this.add(geometry, color, surface);
  }

  /** A thin bar between two points (railings, rebar, cables on facades). */
  bar(from: THREE.Vector3, to: THREE.Vector3, thickness: number, color: Paint, surface: SurfaceId): void {
    const length = from.distanceTo(to);
    const geometry = new THREE.BoxGeometry(thickness, thickness, length);
    const matrix = new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0));
    if (Math.abs(to.x - from.x) < 1e-6 && Math.abs(to.z - from.z) < 1e-6)
      matrix.makeRotationX(Math.PI / 2);
    matrix.setPosition(from.clone().add(to).multiplyScalar(0.5));
    this.add(geometry, color, surface, matrix);
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  finish(): THREE.BufferGeometry {
    const result = mergeGeometries(this.parts);
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    if (!result) throw new Error('Could not assemble geometry.');
    if (this.groundOcclusion) {
      const position = result.getAttribute('position');
      const normal = result.getAttribute('normal');
      const colors = result.getAttribute('color');
      for (let i = 0; i < position.count; i++) {
        if (Math.abs(normal.getY(i)) > 0.5) continue;
        const y = position.getY(i);
        const t = THREE.MathUtils.smoothstep(y, -0.05, 0.42);
        const shade = 0.68 + 0.32 * t;
        colors.setXYZ(i, colors.getX(i) * shade, colors.getY(i) * shade, colors.getZ(i) * shade);
      }
    }
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
  }
}

/** Maps facade coordinates (u along the face, v up, out from the face) into building space. */
export function facePoint(side: Side, halfW: number, halfD: number, u: number, out: number): [number, number, number] {
  switch (side) {
    case 0:
      return [u, halfD + out, 0];
    case 1:
      return [halfW + out, -u, Math.PI / 2];
    case 2:
      return [-u, -halfD - out, Math.PI];
    default:
      return [-halfW - out, u, -Math.PI / 2];
  }
}
