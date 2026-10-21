import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BuildingDefinition, CellPoint, Preview, Snapshot, Structure, Tool } from '../domain';
import { StructureBatches } from './batches';
import { Decor, type Lot } from './decor';
import { type LightingPreset, Lighting } from './lighting';
import { type Context, type Edge, type ModelLibrary, OPEN } from './models';
import { PALETTE } from './palette';
import { heightAt, MARGIN, Terrain } from './terrain';

export { LIGHTING_PRESETS, type LightingPreset } from './lighting';

interface Entry {
  mesh: THREE.Mesh;
  signature: string;
  born: number;
  cell: CellPoint;
  base: THREE.Vector3;
  landed: boolean;
}
interface Dying {
  mesh: THREE.Mesh;
  start: number;
}
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const;
const PLACE_MS = 340;
const REMOVE_MS = 170;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 4;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export class World {
  lighting: LightingPreset = 'afternoon';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 260);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly structures = new Map<number, Entry>();
  readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  frames = 0;
  renderFrames = 0;
  shadowUpdates = 0;
  continuousRendering = false;
  readonly graphics: { quality: 'low' | 'high'; software: boolean; renderer: string; shadowSize: number };
  frameMilliseconds: number[] = [];
  reconciled = 0;
  private needsRender = true;
  private terrain: Terrain;
  private snapshot: Snapshot;
  private seed: number;
  private readonly lights: Lighting;
  private readonly batches = new StructureBatches();
  private readonly decor = new Decor();
  private readonly definitions: Map<string, BuildingDefinition>;
  private readonly dying = new Map<number, Dying>();
  private ghost: THREE.Mesh | null = null;
  private ghostKey = '';
  private readonly ghostMaterial = new THREE.MeshStandardMaterial({
    color: '#fff4e2',
    emissive: '#3d2a14',
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    roughness: 0.9,
  });
  private readonly marker: THREE.Mesh;
  private readonly outline: THREE.LineLoop;
  private readonly rings: { mesh: THREE.Mesh; start: number }[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;
  private targetZoom = 1;
  private orbitTarget: number | null = null;
  private lastFrame = 0;
  private frameRequest = 0;
  private disposed = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    snapshot: Snapshot,
    readonly library: ModelLibrary,
  ) {
    this.snapshot = snapshot;
    this.seed = snapshot.seed;
    this.definitions = new Map(library.catalog.map((def) => [def.id, def]));
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = String(
      debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    const software = /swiftshader|llvmpipe|software/i.test(rendererName);
    const requested = new URLSearchParams(location.search).get('quality');
    const low = requested === 'low' || (requested !== 'high' && software);
    this.graphics = { quality: low ? 'low' : 'high', software, renderer: rendererName, shadowSize: low ? 1024 : 2048 };
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    const center = new THREE.Vector3(snapshot.width / 2, 1, snapshot.depth / 2);
    this.lights = new Lighting(this.scene, this.renderer, center, snapshot.width / 2 + MARGIN + 4, this.graphics.shadowSize);
    this.lights.apply(this.lighting);
    this.terrain = new Terrain(snapshot);
    this.scene.add(this.terrain.group);
    this.camera.position.set(center.x + 27, 34, center.z + 32);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(center.x, 1.2, center.z);
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = 0.12;
    this.controls.enableZoom = false;
    this.controls.rotateSpeed = 0.6;
    this.controls.minPolarAngle = 0.5;
    this.controls.maxPolarAngle = 1.2;
    this.controls.screenSpacePanning = false;
    this.controls.update();
    this.controls.saveState();
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
    });
    canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.marker = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: PALETTE.offWhite, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.marker.renderOrder = 2;
    this.outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.5, 0, -0.5),
        new THREE.Vector3(0.5, 0, -0.5),
        new THREE.Vector3(0.5, 0, 0.5),
        new THREE.Vector3(-0.5, 0, 0.5),
      ]),
      new THREE.LineBasicMaterial({ color: PALETTE.offWhite, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.outline.renderOrder = 3;
    this.marker.visible = this.outline.visible = false;
    this.scene.add(this.marker, this.outline);
    this.scene.add(this.batches.group, this.decor.group);
    this.reconcile(snapshot, false);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.frameRequest = requestAnimationFrame((time) => this.frame(time));
  }

  private resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    // Portrait screens keep the neighborhood's width in view instead of its height.
    const span = aspect < 1 ? 30 / aspect : 27;
    this.camera.left = (-span * aspect) / 2;
    this.camera.right = (span * aspect) / 2;
    this.camera.top = span / 2;
    this.camera.bottom = -span / 2;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = THREE.MathUtils.clamp(event.deltaY * (event.deltaMode === 1 ? 16 : 1), -120, 120);
    this.zoom(Math.exp(-delta * 0.0015));
  }

  /** Classifies the four neighbors of a 1×1 street piece, in its local front/right/back/left order. */
  private context(structure: Structure, occupied: Map<number, Structure>, snapshot: Snapshot): Context {
    if (structure.kind !== 'path') return OPEN;
    const here = snapshot.cells[structure.z * snapshot.width + structure.x]?.height ?? 0;
    return [0, 1, 2, 3].map((side): Edge => {
      const [dx, dz] = DIRECTIONS[(side + structure.rotation) % 4] ?? [0, 0];
      const x = structure.x + dx,
        z = structure.z + dz;
      if (x < 0 || z < 0 || x >= snapshot.width || z >= snapshot.depth) return 'open';
      const there = snapshot.cells[z * snapshot.width + x]?.height ?? 0;
      if (there < here) return 'drop';
      const neighbor = occupied.get(z * snapshot.width + x);
      const category = neighbor && this.definitions.get(neighbor.kind)?.category;
      if (neighbor?.kind === 'stairs' || category === 'path' || category === 'building') return 'link';
      return there > here ? 'rise' : 'open';
    }) as unknown as Context;
  }

  reconcile(snapshot: Snapshot, animate = true): void {
    if (snapshot.seed !== this.seed) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
      this.terrain = new Terrain(snapshot);
      this.scene.add(this.terrain.group);
      this.seed = snapshot.seed;
      animate = false;
    }
    const now = performance.now();
    const motion = animate && !this.reducedMotion;
    const occupied = new Map<number, Structure>();
    for (const structure of snapshot.structures) {
      const def = this.definitions.get(structure.kind);
      if (!def) continue;
      const [w, d] = structure.rotation % 2 ? [def.depth, def.width] : [def.width, def.depth];
      for (let z = structure.z; z < structure.z + d; z++)
        for (let x = structure.x; x < structure.x + w; x++) occupied.set(z * snapshot.width + x, structure);
    }
    const wanted = new Set(snapshot.structures.map((s) => s.id));
    for (const [id, entry] of this.structures)
      if (!wanted.has(id)) {
        this.structures.delete(id);
        if (motion) this.dying.set(id, { mesh: entry.mesh, start: now });
        else this.batches.remove(id);
      }
    for (const structure of snapshot.structures) {
      const context = this.context(structure, occupied, snapshot);
      const height = heightAt(snapshot, structure.x, structure.z);
      const signature = `${structure.kind}/${structure.x}/${structure.z}/${structure.rotation}/${structure.variation}/${height}/${context.join()}`;
      const previous = this.structures.get(structure.id);
      if (previous?.signature === signature) continue;
      if (this.dying.delete(structure.id) || previous) this.batches.remove(structure.id);
      const mesh = this.library.create(structure.kind, structure.variation, context);
      const base = this.position(mesh, structure, height);
      this.batches.add(structure.id, mesh);
      const fresh = !previous && motion;
      this.structures.set(structure.id, {
        mesh,
        signature,
        born: fresh ? now : 0,
        cell: { x: structure.x, z: structure.z },
        base,
        landed: !fresh,
      });
      this.reconciled++;
    }
    const lots: Lot[] = [];
    for (const structure of snapshot.structures) {
      const def = this.definitions.get(structure.kind);
      const entry = this.structures.get(structure.id);
      if (!def || !entry) continue;
      const [width, depth] = this.footprint(structure.kind, structure.rotation);
      lots.push({ structure, category: def.category, width, depth, height: entry.mesh.geometry.boundingBox?.max.y ?? 1 });
    }
    this.decor.update(snapshot, lots);
    this.snapshot = snapshot;
    this.invalidateShadows();
  }

  private footprint(kind: string, rotation: number): [number, number] {
    const def = this.definitions.get(kind);
    if (!def) return [1, 1];
    return rotation % 2 ? [def.depth, def.width] : [def.width, def.depth];
  }

  private position(mesh: THREE.Object3D, structure: Structure, height: number): THREE.Vector3 {
    const [width, depth] = this.footprint(structure.kind, structure.rotation);
    mesh.position.set(structure.x + width / 2, height, structure.z + depth / 2);
    mesh.rotation.y = (structure.rotation * Math.PI) / 2;
    return mesh.position.clone();
  }

  pick(clientX: number, clientY: number): CellPoint | null {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.terrain.pickable.updateWorldMatrix(true, false);
    this.batches.group.updateWorldMatrix(true, true);
    const hit = this.raycaster.intersectObjects([this.terrain.pickable, this.batches.group], true)[0];
    if (!hit) return null;
    if (hit.object === this.terrain.pickable) return this.terrain.cellFromIntersection(hit);
    const id = this.batches.placementId(hit);
    return id === undefined ? null : (this.structures.get(id)?.cell ?? null);
  }

  showGhost(tool: Tool, cell: CellPoint | null, preview: Preview | null, rotation: number): void {
    this.needsRender = true;
    const active = !!cell && tool.type !== 'navigate';
    this.marker.visible = this.outline.visible = active;
    if (this.ghost) this.ghost.visible = false;
    if (!cell || !active) return;
    let [w, d] = [preview?.width || 1, preview?.depth || 1];
    let origin = cell;
    if (tool.type === 'remove') {
      const target = this.snapshot.structures.find((s) => {
        const [sw, sd] = this.footprint(s.kind, s.rotation);
        return cell.x >= s.x && cell.x < s.x + sw && cell.z >= s.z && cell.z < s.z + sd;
      });
      if (target) {
        origin = { x: target.x, z: target.z };
        [w, d] = this.footprint(target.kind, target.rotation);
      }
    }
    const valid = tool.type === 'place' && !!preview?.valid;
    const tone = tool.type === 'remove' || !valid ? PALETTE.coral : PALETTE.offWhite;
    const y = heightAt(this.snapshot, origin.x, origin.z);
    this.marker.position.set(origin.x + w / 2, y + 0.03, origin.z + d / 2);
    this.marker.scale.set(w, 1, d);
    this.outline.position.copy(this.marker.position);
    this.outline.position.y += 0.02;
    this.outline.scale.set(w - 0.04, 1, d - 0.04);
    (this.marker.material as THREE.MeshBasicMaterial).color.set(tone);
    (this.marker.material as THREE.MeshBasicMaterial).opacity = tool.type === 'remove' ? 0.4 : 0.26;
    (this.outline.material as THREE.LineBasicMaterial).color.set(tone);
    if (tool.type !== 'place') return;
    const key = `${tool.kind}`;
    if (this.ghostKey !== key) {
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = this.library.create(tool.kind, 0);
      this.ghost.material = this.ghostMaterial;
      this.ghost.castShadow = false;
      this.ghost.receiveShadow = false;
      this.ghost.renderOrder = 4;
      this.ghostKey = key;
      this.scene.add(this.ghost);
    }
    if (this.ghost) {
      this.ghost.visible = true;
      this.ghost.position.set(cell.x + w / 2, heightAt(this.snapshot, cell.x, cell.z) + 0.02, cell.z + d / 2);
      this.ghost.rotation.y = (rotation * Math.PI) / 2;
      this.ghostMaterial.color.set(valid ? '#fff4e2' : PALETTE.coral);
      this.ghostMaterial.opacity = valid ? 0.62 : 0.4;
    }
  }

  screenCell(x: number, z: number, elevation = 0): { x: number; y: number } {
    const point = new THREE.Vector3(x + 0.5, heightAt(this.snapshot, x, z) + 0.01 + elevation, z + 0.5).project(
      this.camera,
    );
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: bounds.left + ((point.x + 1) / 2) * bounds.width,
      y: bounds.top + ((1 - point.y) / 2) * bounds.height,
    };
  }

  setView(view: { zoom?: number; azimuth?: number; polar?: number; target?: [number, number, number] }): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    if (view.target) this.controls.target.set(...view.target);
    if (view.azimuth !== undefined) spherical.theta = view.azimuth;
    if (view.polar !== undefined) spherical.phi = view.polar;
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    if (view.zoom !== undefined) this.camera.zoom = this.targetZoom = view.zoom;
    this.camera.updateProjectionMatrix();
    this.orbitTarget = null;
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    this.needsRender = true;
  }

  setLighting(preset: LightingPreset): void {
    this.lighting = preset;
    this.lights.apply(preset);
    this.invalidateShadows();
  }

  /** Quarter-turn orbit; eased unless the player prefers reduced motion. */
  rotateView(direction: 1 | -1): void {
    const spherical = new THREE.Spherical().setFromVector3(
      this.camera.position.clone().sub(this.controls.target),
    );
    const start = this.orbitTarget ?? spherical.theta;
    const target = start + (direction * Math.PI) / 2;
    if (this.reducedMotion) this.setView({ azimuth: target });
    else this.orbitTarget = target;
    this.needsRender = true;
  }

  home(): void {
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.reset();
    this.controls.enableDamping = damping;
    this.targetZoom = this.camera.zoom;
    this.orbitTarget = null;
  }

  zoom(factor: number): void {
    this.targetZoom = THREE.MathUtils.clamp(this.targetZoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (this.reducedMotion) {
      this.camera.zoom = this.targetZoom;
      this.camera.updateProjectionMatrix();
    }
    this.needsRender = true;
  }

  invalidateShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }

  private ring(position: THREE.Vector3, size: number): void {
    let slot = this.rings.find((ring) => !ring.mesh.visible);
    if (!slot) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: PALETTE.offWhite, transparent: true, depthWrite: false }),
      );
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      slot = { mesh, start: 0 };
      this.rings.push(slot);
    }
    slot.mesh.visible = true;
    slot.mesh.position.copy(position).setY(position.y + 0.04);
    slot.mesh.userData.size = size;
    slot.start = performance.now();
  }

  /** Advances placement, removal, ring, zoom, and orbit easing. Returns true while anything moves. */
  private animate(time: number): boolean {
    let moving = false;
    for (const [id, entry] of this.structures) {
      if (!entry.born) continue;
      const t = Math.min((time - entry.born) / PLACE_MS, 1);
      const fall = t < 0.62 ? easeOutCubic(t / 0.62) : 1;
      const settle = t < 0.62 ? 0 : Math.sin(((t - 0.62) / 0.38) * Math.PI);
      entry.mesh.position.copy(entry.base).setY(entry.base.y + (1 - fall) * 0.6);
      entry.mesh.scale.set(1 + settle * 0.035, 1 - settle * 0.07, 1 + settle * 0.035);
      if (!entry.landed && t >= 0.62) {
        entry.landed = true;
        const [w, d] = [entry.mesh.geometry.boundingBox?.max.x ?? 0.5, entry.mesh.geometry.boundingBox?.max.z ?? 0.5];
        this.ring(entry.base, Math.max(w, d) * 2);
      }
      if (t === 1) {
        entry.born = 0;
        entry.mesh.scale.setScalar(1);
        entry.mesh.position.copy(entry.base);
        this.invalidateShadows();
      }
      this.batches.update(id);
      moving = true;
    }
    for (const [id, dying] of this.dying) {
      const t = Math.min((time - dying.start) / REMOVE_MS, 1);
      const shrink = 1 - t * t;
      dying.mesh.scale.set(shrink, Math.max(shrink, 0.001), shrink);
      this.batches.update(id);
      if (t === 1) {
        this.batches.remove(id);
        this.dying.delete(id);
        this.invalidateShadows();
      }
      moving = true;
    }
    for (const ring of this.rings) {
      if (!ring.mesh.visible) continue;
      const t = (time - ring.start) / 520;
      if (t >= 1) {
        ring.mesh.visible = false;
        this.needsRender = true;
        continue;
      }
      const size = (ring.mesh.userData.size as number) * (0.8 + easeOutCubic(t) * 0.55);
      ring.mesh.scale.set(size, 1, size);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
      moving = true;
    }
    if (Math.abs(this.camera.zoom - this.targetZoom) > 1e-4) {
      this.camera.zoom += (this.targetZoom - this.camera.zoom) * 0.2;
      if (Math.abs(this.camera.zoom - this.targetZoom) < 1e-3) this.camera.zoom = this.targetZoom;
      this.camera.updateProjectionMatrix();
      moving = true;
    }
    if (this.orbitTarget !== null) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      const delta = this.orbitTarget - spherical.theta;
      const wrapped = Math.atan2(Math.sin(delta), Math.cos(delta));
      spherical.theta += Math.abs(wrapped) < 0.002 ? wrapped : wrapped * 0.16;
      if (Math.abs(wrapped) < 0.002) this.orbitTarget = null;
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      this.camera.lookAt(this.controls.target);
      moving = true;
    }
    const target = this.controls.target;
    const limit = this.snapshot.width + 2;
    if (target.x < -2 || target.z < -2 || target.x > limit || target.z > limit) {
      const clamped = target.clone().set(THREE.MathUtils.clamp(target.x, -2, limit), target.y, THREE.MathUtils.clamp(target.z, -2, limit));
      this.camera.position.add(clamped.clone().sub(target));
      target.copy(clamped);
    }
    return moving;
  }

  private frame(time: number): void {
    if (this.disposed) return;
    const animating = this.animate(time);
    const cameraMoved = this.controls.update();
    if (this.needsRender || cameraMoved || animating || this.continuousRendering) {
      if (this.lastFrame) {
        if (this.frameMilliseconds.length >= 600) this.frameMilliseconds.shift();
        this.frameMilliseconds.push(time - this.lastFrame);
      }
      this.lastFrame = time;
      if (this.renderer.shadowMap.needsUpdate) this.shadowUpdates++;
      this.renderer.render(this.scene, this.camera);
      this.renderFrames++;
      this.needsRender = false;
    } else {
      this.lastFrame = 0;
    }
    this.frames++;
    this.frameRequest = requestAnimationFrame((next) => this.frame(next));
  }

  metrics(): object {
    const sorted = [...this.frameMilliseconds].sort((a, b) => a - b);
    let renderObjectCount = 0;
    this.scene.traverseVisible((object) => {
      if (object instanceof THREE.Mesh && (!(object instanceof THREE.InstancedMesh) || object.count > 0))
        renderObjectCount++;
    });
    return {
      frames: this.frames,
      renderFrames: this.renderFrames,
      continuousRendering: this.continuousRendering,
      graphics: this.graphics,
      lighting: this.lighting,
      shadowUpdates: this.shadowUpdates,
      shadowAutoUpdate: this.renderer.shadowMap.autoUpdate,
      shadowNeedsUpdate: this.renderer.shadowMap.needsUpdate,
      frameMs: sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0,
      p95FrameMs: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
      frameSamples: sorted.length,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      structures: this.structures.size,
      structureParts: this.batches.partCount,
      batchCount: this.batches.batchCount,
      allocatedBatchCount: this.batches.allocatedBatchCount,
      renderObjectCount,
      reconciled: this.reconciled,
      pixelRatio: this.renderer.getPixelRatio(),
      viewport: { width: this.canvas.width, height: this.canvas.height },
      renderer: this.graphics.renderer,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameRequest);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.terrain.dispose();
    this.batches.dispose();
    this.decor.dispose();
    this.lights.dispose();
    this.ghostMaterial.dispose();
    this.renderer.dispose();
  }
}
