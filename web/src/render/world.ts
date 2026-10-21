import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CellPoint, Preview, Snapshot, Structure, Tool } from '../domain';
import { type AssetState, loadLandmark } from './assets';
import { StructureBatches } from './batches';
import type { ModelLibrary } from './models';
import { heightAt, Terrain } from './terrain';
export type LightingPreset = 'afternoon' | 'daylight' | 'evening';
export const LIGHTING_PRESETS: readonly LightingPreset[] = ['afternoon', 'daylight', 'evening'];
export class World {
  lighting: LightingPreset = 'afternoon';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 220);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly structures = new Map<
    number,
    { mesh: THREE.Mesh; signature: string; born: number; cell: CellPoint }
  >();
  readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  assetState: AssetState = { status: 'loading' };
  frames = 0;
  renderFrames = 0;
  shadowUpdates = 0;
  continuousRendering = false;
  readonly graphics: { quality: 'low' | 'high'; software: boolean; renderer: string; shadowSize: number };
  private needsRender = true;
  frameMilliseconds: number[] = [];
  reconciled = 0;
  private terrain: Terrain;
  private snapshot: Snapshot;
  private seed: number;
  private readonly batches = new StructureBatches();
  private ghost: THREE.Mesh | null = null;
  private ghostKind = '';
  private readonly ghostMaterial = new THREE.MeshStandardMaterial({
    color: '#245beb',
    transparent: true,
    opacity: 0.53,
    depthWrite: false,
    roughness: 0.8,
  });
  private readonly marker: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;
  private lastFrame = 0;
  private frameRequest = 0;
  private disposed = false;
  constructor(
    readonly canvas: HTMLCanvasElement,
    snapshot: Snapshot,
    readonly library: ModelLibrary,
    onAsset: (state: AssetState) => void,
  ) {
    this.snapshot = snapshot;
    this.seed = snapshot.seed;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = String(
      debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    const software = /swiftshader|llvmpipe|software/i.test(rendererName);
    const requested = new URLSearchParams(location.search).get('quality');
    const low = requested === 'low' || (requested !== 'high' && software);
    this.graphics = {
      quality: low ? 'low' : 'high',
      software,
      renderer: rendererName,
      shadowSize: low ? 512 : 2048,
    };
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.background = new THREE.Color('#d9e6e2');
    this.scene.fog = new THREE.Fog('#d9e6e2', 60, 150);
    this.scene.add(new THREE.HemisphereLight('#edf4ff', '#afab87', 2.3));
    const sun = new THREE.DirectionalLight('#ffefcf', 3.3);
    sun.position.set(-12, 34, 23);
    sun.target.position.set(16, 0, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.graphics.shadowSize, this.graphics.shadowSize);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 100;
    sun.shadow.normalBias = 0.035;
    sun.shadow.bias = -0.00015;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    this.terrain = new Terrain(snapshot);
    this.scene.add(this.terrain.group);
    this.camera.position.set(43, 34, 48);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(16, 1, 16);
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = 0.1;
    this.controls.minZoom = 0.65;
    this.controls.maxZoom = 3.5;
    this.controls.minPolarAngle = 0.28;
    this.controls.maxPolarAngle = 1.25;
    this.controls.screenSpacePanning = false;
    this.controls.update();
    this.controls.saveState();
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
    });
    this.marker = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.025, 1),
      new THREE.MeshBasicMaterial({ color: '#245beb', transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.scene.add(this.batches.group);
    this.reconcile(snapshot, false);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      onAsset({
        status: 'error',
        message: 'The graphics connection was interrupted. Reload to continue from your autosave.',
      });
    });
    void loadLandmark(this.scene, (state) => {
      this.assetState = state;
      this.invalidateShadows();
      onAsset(state);
    });
    this.frameRequest = requestAnimationFrame((time) => this.frame(time));
  }
  private resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    this.renderer.setSize(width, height, false);
    const span = 27;
    const aspect = width / height;
    this.camera.left = (-span * aspect) / 2;
    this.camera.right = (span * aspect) / 2;
    this.camera.top = span / 2;
    this.camera.bottom = -span / 2;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }
  reconcile(snapshot: Snapshot, animate = true): void {
    if (snapshot.seed !== this.seed) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
      this.terrain = new Terrain(snapshot);
      this.scene.add(this.terrain.group);
      this.seed = snapshot.seed;
    }
    const wanted = new Set(snapshot.structures.map((s) => s.id));
    for (const id of this.structures.keys())
      if (!wanted.has(id)) {
        this.batches.remove(id);
        this.structures.delete(id);
      }
    for (const structure of snapshot.structures) {
      const signature = `${structure.kind}/${structure.x}/${structure.z}/${structure.rotation}/${structure.variation}/${heightAt(snapshot, structure.x, structure.z)}`;
      const previous = this.structures.get(structure.id);
      if (previous?.signature === signature) continue;
      if (previous) this.batches.remove(structure.id);
      const mesh = this.library.create(structure.kind, structure.variation);
      this.position(mesh, structure, snapshot);
      this.batches.add(structure.id, mesh);
      this.structures.set(structure.id, {
        mesh,
        signature,
        born: animate && !this.reducedMotion ? performance.now() : 0,
        cell: { x: structure.x, z: structure.z },
      });
      this.reconciled++;
    }
    this.snapshot = snapshot;
    this.invalidateShadows();
  }
  private position(mesh: THREE.Mesh, structure: Structure, snapshot: Snapshot): void {
    const definition = this.library.catalog.find((def) => def.id === structure.kind);
    if (!definition) return;
    const [width, depth] =
      structure.rotation % 2 ? [definition.depth, definition.width] : [definition.width, definition.depth];
    mesh.position.set(
      structure.x + width / 2,
      heightAt(snapshot, structure.x, structure.z),
      structure.z + depth / 2,
    );
    mesh.rotation.y = (structure.rotation * Math.PI) / 2;
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
    const objects: THREE.Object3D[] = [this.terrain.pickable, this.batches.group];
    const hit = this.raycaster.intersectObjects(objects, true)[0];
    if (!hit) return null;
    if (hit.object === this.terrain.pickable) return this.terrain.cellFromIntersection(hit);
    const id = this.batches.placementId(hit);
    return id === undefined ? null : (this.structures.get(id)?.cell ?? null);
  }
  showGhost(tool: Tool, cell: CellPoint | null, preview: Preview | null, rotation: number): void {
    this.needsRender = true;
    this.marker.visible = !!cell && tool.type !== 'navigate';
    if (this.ghost) this.ghost.visible = false;
    if (!cell || tool.type === 'navigate') return;
    const color = tool.type === 'remove' ? '#b42336' : preview?.valid ? '#245beb' : '#b42336';
    const w = preview?.width ?? 1,
      d = preview?.depth ?? 1;
    this.marker.position.set(cell.x + w / 2, heightAt(this.snapshot, cell.x, cell.z) + 0.035, cell.z + d / 2);
    this.marker.scale.set(w, 1, d);
    if (this.marker.material instanceof THREE.MeshBasicMaterial) this.marker.material.color.set(color);
    if (tool.type !== 'place') return;
    if (this.ghostKind !== tool.kind) {
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = this.library.create(tool.kind);
      this.ghost.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.material = this.ghostMaterial;
          object.castShadow = false;
        }
      });
      this.ghostKind = tool.kind;
      this.scene.add(this.ghost);
    }
    if (this.ghost) {
      this.ghost.visible = true;
      this.ghost.position.set(cell.x + w / 2, heightAt(this.snapshot, cell.x, cell.z) + 0.04, cell.z + d / 2);
      this.ghost.rotation.y = (rotation * Math.PI) / 2;
      this.ghostMaterial.color.set(color);
    }
  }
  screenCell(x: number, z: number, elevation = 0): { x: number; y: number } {
    const point = new THREE.Vector3(
      x + 0.5,
      heightAt(this.snapshot, x, z) + 0.01 + elevation,
      z + 0.5,
    ).project(this.camera);
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: bounds.left + ((point.x + 1) / 2) * bounds.width,
      y: bounds.top + ((1 - point.y) / 2) * bounds.height,
    };
  }
  home(): void {
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.reset();
    this.controls.enableDamping = damping;
  }
  setView(view: { zoom?: number; azimuth?: number; polar?: number; target?: [number, number, number] }): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    if (view.target) this.controls.target.set(...view.target);
    if (view.azimuth !== undefined) spherical.theta = view.azimuth;
    if (view.polar !== undefined) spherical.phi = view.polar;
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    if (view.zoom !== undefined) this.camera.zoom = view.zoom;
    this.camera.updateProjectionMatrix();
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    this.needsRender = true;
  }
  setLighting(preset: LightingPreset): void {
    this.lighting = preset;
    this.invalidateShadows();
  }
  rotateView(direction: 1 | -1): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    this.setView({ azimuth: spherical.theta + (direction * Math.PI) / 2 });
  }
  zoom(factor: number): void {
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, 0.65, 3.5);
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }
  invalidateShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }
  private frame(time: number): void {
    if (this.disposed) return;
    const cameraMoved = this.controls.update();
    let animating = false;
    for (const [id, entry] of this.structures)
      if (entry.born) {
        const t = Math.min((time - entry.born) / 240, 1);
        entry.mesh.scale.y = 1 - (1 - t) ** 3 * 0.65;
        this.batches.update(id);
        animating = true;
        if (t === 1) {
          entry.born = 0;
          this.invalidateShadows();
        }
      }
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
      asset: this.assetState,
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
    this.ghostMaterial.dispose();
    this.renderer.dispose();
  }
}
