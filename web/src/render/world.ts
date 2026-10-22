import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  type HandTile,
  type HexPoint,
  type Preview,
  rotateSides,
  type Snapshot,
  type Spot,
  type Tile,
} from '../domain';
import { StructureBatches } from './batches';
import { type EnvironmentSelection, environmentFor, GroundField, parseEnvironmentQuery } from './environment';
import { fillGeometry, groundGeometry, hexagon, rimGeometry } from './ground';
import { center, DIRECTIONS, edgeAngle, HEX, key, LEVEL } from './hex';
import { Lighting, type LightingPreset } from './lighting';
import { createWorldMaterial, setEnvironment, setPatterns, worldMaterial } from './material';
import { PALETTE } from './palette';
import { type SideState, TileKit, type TileSite } from './tiles';

export { LIGHTING_PRESETS, type LightingPreset } from './lighting';

interface Entry {
  root: THREE.Group;
  signature: string;
  born: number;
  hex: HexPoint;
  base: THREE.Vector3;
  landed: boolean;
}
interface Dying {
  root: THREE.Group;
  start: number;
}
const PLACE_MS = 320;
const REMOVE_MS = 170;
const RING_POOL = 6;
/** Edits larger than this (loads, resets, undoing a reset) appear at once instead of raining down. */
const ANIMATED_EDIT_LIMIT = 4;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 5;
/**
 * Camera azimuth looking along a tile corner. Every wall and house facade then turns 30° to the viewer, so
 * buildings show two faces; looking straight across an edge flattened facades into single planes.
 */
const HOME_AZIMUTH = Math.PI / 6;
const HOME_POLAR = 0.86;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
/** Placement indicator colors: quiet cream for open spots, teal for joins, a muted red for refusals. */
const INDICATOR = {
  available: '#fffaf2',
  match: '#1f7a64',
  open: '#fffaf2',
  steep: '#b8442f',
  blocked: '#b8442f',
} as const;

export class World {
  lighting: LightingPreset = 'afternoon';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 400);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly tiles = new Map<number, Entry>();
  readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  frames = 0;
  renderFrames = 0;
  shadowUpdates = 0;
  continuousRendering = false;
  readonly graphics: { quality: 'low' | 'high'; software: boolean; renderer: string; shadowSize: number };
  frameMilliseconds: number[] = [];
  renderMilliseconds: number[] = [];
  private readonly profile = new URLSearchParams(location.search).has('profile');
  /** Chosen once from the URL: Balanced unless `?environment=` names another candidate or `legacy`. */
  readonly environment: EnvironmentSelection = parseEnvironmentQuery(location.search);
  private readonly probePixel = new Uint8Array(4);
  reconciled = 0;
  reconcileMilliseconds = 0;
  private needsRender = true;
  private snapshot: Snapshot;
  private readonly lights: Lighting;
  private readonly kit = new TileKit();
  private readonly batches = new StructureBatches();
  private readonly dying = new Map<number, Dying>();
  private readonly ground: THREE.Mesh;
  private readonly frontier: THREE.Group;
  private readonly frontierRims: THREE.Mesh;
  private readonly frontierFills: THREE.Mesh;
  private readonly blockedRims: THREE.Mesh;
  private pickable: THREE.InstancedMesh;
  private pickCells: { q: number; r: number; elevation: number }[] = [];
  private readonly pickGeometry = hexagon(HEX, 0.08);
  private readonly pickMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private readonly ghost = new THREE.Group();
  private ghostKey = '';
  /**
   * Translucent but depth-writing, so the ghost reads as a solid tile and not a stack of see-through parts. It
   * shares the board's shader, so the tile in hand shows the colors it will have once placed.
   */
  private readonly ghostMaterial = createWorldMaterial({
    transparent: true,
    opacity: 0.85,
    depthWrite: true,
  });
  private readonly ghostBase: THREE.Mesh;
  private readonly hoverOutline: THREE.Mesh;
  private readonly hoverDashed: THREE.Mesh;
  private readonly refusal: THREE.Mesh;
  private readonly markers: THREE.Mesh[] = [];
  private readonly crosses: THREE.Mesh[] = [];
  private readonly rings: { mesh: THREE.Mesh; start: number }[] = [];
  private readonly ringGeometry = new THREE.RingGeometry(0.88, 1, 6, 1, 0).rotateX(-Math.PI / 2);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;
  private readonly bounds = { center: new THREE.Vector3(), radius: 8 };
  private targetZoom = 1.2;
  private orbitTarget: number | null = null;
  private lastFrame = 0;
  private frameRequest = 0;
  private disposed = false;
  private span = 27;
  private debugModule: typeof import('./debug') | undefined;
  private debugRoot: THREE.Group | undefined;
  private debugOn = false;

  async enableDebug(): Promise<void> {
    this.debugModule = await import('./debug');
  }

  debug(on = !this.debugOn): boolean {
    if (!this.debugModule || this.disposed) return false;
    this.debugOn = on;
    this.rebuildDebug();
    return this.debugOn;
  }

  private rebuildDebug(): void {
    if (this.debugRoot) this.debugModule?.disposeDebug(this.debugRoot);
    this.debugRoot = undefined;
    if (this.debugOn && this.debugModule) {
      this.debugRoot = this.debugModule.buildDebug(this.snapshot, (site, sides) =>
        this.kit.plan(site, sides),
      );
      this.scene.add(this.debugRoot);
    }
    this.needsRender = true;
  }

  constructor(
    readonly canvas: HTMLCanvasElement,
    snapshot: Snapshot,
  ) {
    this.snapshot = snapshot;
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
      shadowSize: low ? 1024 : 2048,
    };
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 2));
    setPatterns(!low);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.measure(snapshot);
    this.lights = new Lighting(
      this.scene,
      this.renderer,
      this.bounds.center,
      this.bounds.radius + 4,
      this.graphics.shadowSize,
      this.environment,
    );
    this.lights.apply(this.lighting);

    this.ground = new THREE.Mesh(new THREE.BufferGeometry(), worldMaterial);
    this.ground.receiveShadow = true;
    this.ground.castShadow = true;
    const indicator = (color: string, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
    this.frontierRims = new THREE.Mesh(new THREE.BufferGeometry(), indicator(INDICATOR.available, 0.42));
    this.frontierFills = new THREE.Mesh(new THREE.BufferGeometry(), indicator(INDICATOR.available, 0.08));
    this.blockedRims = new THREE.Mesh(new THREE.BufferGeometry(), indicator(INDICATOR.blocked, 0.32));
    this.frontier = new THREE.Group();
    this.frontier.add(this.frontierFills, this.frontierRims, this.blockedRims);
    for (const mesh of [this.frontierFills, this.frontierRims, this.blockedRims]) mesh.renderOrder = 2;
    this.pickable = new THREE.InstancedMesh(this.pickGeometry, this.pickMaterial, 1);
    // A faint disc shows the ground the tile will claim.
    this.ghostBase = new THREE.Mesh(
      hexagon(HEX * 0.97).translate(0, 0.005, 0),
      new THREE.MeshBasicMaterial({
        color: PALETTE.offWhite,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    this.ghostBase.renderOrder = 3;
    const origin = [{ q: 0, r: 0, elevation: 0 }];
    const overlay = (geometry: THREE.BufferGeometry, color: string, opacity: number) => {
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.renderOrder = 6;
      return mesh;
    };
    this.hoverOutline = overlay(
      rimGeometry(origin, { inset: 0.97, width: 0.1, lift: 0.01 }),
      INDICATOR.available,
      0.9,
    );
    this.hoverDashed = overlay(
      rimGeometry(origin, { inset: 0.97, width: 0.1, dashed: true, lift: 0.01 }),
      INDICATOR.blocked,
      0.8,
    );
    // A centered cross marks a spot where the tile cannot go in this rotation, readable without color.
    const cross = (size: number, thickness: number) => {
      const arm = new THREE.BoxGeometry(size, 0.02, thickness);
      const other = arm.clone().rotateY(Math.PI / 2);
      const merged = new THREE.BufferGeometry();
      const a = arm.toNonIndexed(),
        b = other.toNonIndexed();
      const positions = new Float32Array([
        ...a.getAttribute('position').array,
        ...b.getAttribute('position').array,
      ]);
      merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      for (const g of [arm, other, a, b]) g.dispose();
      return merged.rotateY(Math.PI / 4);
    };
    this.refusal = overlay(cross(0.75, 0.12), INDICATOR.blocked, 0.85);
    this.refusal.position.y = 0.08;
    const markerGeometry = new THREE.BoxGeometry(HEX * 0.5, 0.05, 0.14);
    const markerCross = cross(0.34, 0.07);
    for (let side = 0; side < 6; side++) {
      const marker = new THREE.Mesh(
        markerGeometry,
        new THREE.MeshBasicMaterial({ color: PALETTE.offWhite, transparent: true, depthTest: false }),
      );
      marker.renderOrder = 7;
      this.markers.push(marker);
      const mark = new THREE.Mesh(
        markerCross,
        new THREE.MeshBasicMaterial({ color: INDICATOR.blocked, transparent: true, depthTest: false }),
      );
      mark.renderOrder = 8;
      this.crosses.push(mark);
    }
    this.ghost.add(
      this.ghostBase,
      this.hoverOutline,
      this.hoverDashed,
      this.refusal,
      ...this.markers,
      ...this.crosses,
    );
    this.ghost.visible = false;
    this.scene.add(this.ground, this.frontier, this.pickable, this.ghost, this.batches.group);

    this.camera.position.set(0, 30, 30);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = 0.12;
    this.controls.enableZoom = false;
    this.controls.rotateSpeed = 0.6;
    this.controls.minPolarAngle = 0.45;
    this.controls.maxPolarAngle = 1.2;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
    });
    canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.reconcile(snapshot, false);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.home(true);
    this.frameRequest = requestAnimationFrame((time) => this.frame(time));
  }

  /** Center and radius of the placed tiles and the spots around them, in world space. */
  private measure(snapshot: Snapshot): void {
    const points = [...snapshot.tiles, ...snapshot.frontier].map((tile) => {
      const c = center(tile.q, tile.r);
      return new THREE.Vector3(c.x, tile.elevation * LEVEL, c.z);
    });
    if (!points.length) points.push(new THREE.Vector3());
    const middle = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length);
    this.bounds.center.copy(middle);
    this.bounds.radius = Math.max(...points.map((p) => Math.hypot(p.x - middle.x, p.z - middle.z))) + HEX;
  }

  private resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    // Portrait screens keep the neighborhood's width in view instead of its height.
    const span = aspect < 1 ? this.span / aspect : this.span;
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

  /** How each side of a placed tile meets its neighbor, from the Rust meets and the neighbors' heights. */
  private sideStates(tile: Tile, byKey: Map<string, Tile>): SideState[] {
    return DIRECTIONS.map((d, side) => {
      const other = byKey.get(key(tile.q + d.q, tile.r + d.r));
      return { meet: tile.meets[side] ?? 'open', rise: other ? other.elevation - tile.elevation : 0 };
    });
  }

  /** Every tile, placed or previewed, dresses itself for the current world's region and seed. */
  private site(tile: Omit<TileSite, 'region' | 'seed'>): TileSite {
    return { ...tile, region: this.snapshot.region, seed: this.snapshot.seed };
  }

  reconcile(snapshot: Snapshot, animate = true): void {
    const started = performance.now();
    const now = performance.now();
    const byKey = new Map(snapshot.tiles.map((tile) => [key(tile.q, tile.r), tile]));
    const wanted = new Set(snapshot.tiles.map((_, index) => index));
    const changes =
      snapshot.tiles.filter(
        (tile, index) => this.tiles.get(index)?.hex.q !== tile.q || this.tiles.get(index)?.hex.r !== tile.r,
      ).length + [...this.tiles.keys()].filter((id) => !wanted.has(id)).length;
    const motion = animate && !this.reducedMotion && changes <= ANIMATED_EDIT_LIMIT;
    for (const [id, entry] of this.tiles)
      if (!wanted.has(id) || snapshot.tiles[id]?.q !== entry.hex.q || snapshot.tiles[id]?.r !== entry.hex.r) {
        this.tiles.delete(id);
        if (motion && !wanted.has(id)) this.dying.set(id, { root: entry.root, start: now });
        else this.batches.remove(id);
      }
    this.snapshot = snapshot;
    snapshot.tiles.forEach((tile, id) => {
      const near = this.sideStates(tile, byKey);
      const signature = `${tile.q},${tile.r}/${snapshot.seed}/${snapshot.region}/${tile.kind}/${tile.edges.join()}/${tile.paths.join()}/${tile.variation}/${tile.elevation}/${near
        .map((n) => `${n.meet}${n.rise}`)
        .join()}`;
      const previous = this.tiles.get(id);
      if (previous?.signature === signature) return;
      if (this.dying.delete(id) || previous) this.batches.remove(id);
      const root = this.compose(this.site(tile), near);
      const c = center(tile.q, tile.r);
      root.position.set(c.x, tile.elevation * LEVEL, c.z);
      const base = root.position.clone();
      this.batches.add(id, root);
      const fresh = !previous && motion;
      this.tiles.set(id, {
        root,
        signature,
        born: fresh ? now : 0,
        hex: { q: tile.q, r: tile.r },
        base,
        landed: !fresh,
      });
      this.reconciled++;
    });
    this.ground.geometry.dispose();
    const environment = environmentFor(this.environment, snapshot.region);
    setEnvironment(environment && { environment, seed: snapshot.seed });
    this.ground.geometry = groundGeometry(
      snapshot.tiles,
      snapshot.region,
      environment ? new GroundField(environment, snapshot.seed) : undefined,
      new Map(
        snapshot.tiles.map((tile) => [
          key(tile.q, tile.r),
          this.kit.plan(this.site(tile), this.sideStates(tile, byKey)).pedestrian.boundaries,
        ]),
      ),
    );
    this.lights.setRegion(snapshot.region);
    this.showFrontier(snapshot.frontier);
    this.rebuildPicking(snapshot);
    this.measure(snapshot);
    this.lights.frame(this.bounds.center, this.bounds.radius + 6);
    this.ghostKey = '';
    this.invalidateShadows();
    this.rebuildDebug();
    this.reconcileMilliseconds = performance.now() - started;
  }

  /** Open spots: a quiet rim where the tile in hand fits, a dashed one where it fits in no rotation. */
  private showFrontier(spots: readonly Spot[]): void {
    for (const mesh of [this.frontierRims, this.frontierFills, this.blockedRims]) mesh.geometry.dispose();
    const open = spots.filter((spot) => spot.playable);
    this.frontierRims.geometry = rimGeometry(open);
    this.frontierFills.geometry = fillGeometry(open);
    this.blockedRims.geometry = rimGeometry(
      spots.filter((spot) => !spot.playable),
      { dashed: true, width: 0.07 },
    );
  }

  private compose(
    tile: TileSite,
    near: readonly (SideState | undefined)[],
    material: THREE.Material = worldMaterial,
  ): THREE.Group {
    const root = new THREE.Group();
    for (const part of this.kit.compose(tile, near)) {
      const mesh = new THREE.Mesh(part.geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(part.matrix);
      mesh.castShadow = material === worldMaterial;
      mesh.receiveShadow = material === worldMaterial;
      root.add(mesh);
    }
    return root;
  }

  private rebuildPicking(snapshot: Snapshot): void {
    this.scene.remove(this.pickable);
    this.pickable.dispose();
    this.pickCells = [...snapshot.tiles, ...snapshot.frontier];
    this.pickable = new THREE.InstancedMesh(
      this.pickGeometry,
      this.pickMaterial,
      Math.max(1, this.pickCells.length),
    );
    this.pickable.count = this.pickCells.length;
    const dummy = new THREE.Object3D();
    this.pickCells.forEach((cell, index) => {
      const c = center(cell.q, cell.r);
      dummy.position.set(c.x, cell.elevation * LEVEL - 0.06, c.z);
      dummy.updateMatrix();
      this.pickable.setMatrixAt(index, dummy.matrix);
    });
    this.pickable.computeBoundingSphere();
    this.scene.add(this.pickable);
  }

  pick(clientX: number, clientY: number): HexPoint | null {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.pickable.updateWorldMatrix(true, false);
    const hit = this.raycaster.intersectObject(this.pickable, false)[0];
    if (hit?.instanceId === undefined) return null;
    const cell = this.pickCells[hit.instanceId];
    return cell ? { q: cell.q, r: cell.r } : null;
  }

  /** Shows the tile in hand at the hovered spot, with each edge marked by how it would meet its neighbor. */
  showGhost(hex: HexPoint | null, preview: Preview | null, hand: HandTile | null, rotation: number): void {
    this.needsRender = true;
    const spot = hex && this.snapshot.frontier.find((cell) => cell.q === hex.q && cell.r === hex.r);
    this.frontier.visible = !this.snapshot.finished;
    if (!hex || !spot || !preview || !hand) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    const c = center(hex.q, hex.r);
    this.ghost.position.set(c.x, spot.elevation * LEVEL + 0.03, c.z);
    const valid = preview.valid;
    const ghostKey = `${hex.q},${hex.r}/${rotation}/${hand.kind}/${hand.edges.join()}/${hand.paths.join()}/${this.snapshot.revision}`;
    if (ghostKey !== this.ghostKey) {
      this.ghostKey = ghostKey;
      for (const child of [...this.ghost.children]) if (child.userData.content) this.ghost.remove(child);
      const sides: SideState[] = preview.sides.map((side) => ({ meet: side.meet, rise: side.rise }));
      const content = this.compose(
        this.site({
          q: hex.q,
          r: hex.r,
          kind: hand.kind,
          edges: rotateSides(hand.edges, rotation),
          paths: rotateSides(hand.paths, rotation),
          entrances: rotateSides(hand.entrances, rotation),
          variation: preview.variation,
          elevation: spot.elevation,
        }),
        sides,
        this.ghostMaterial,
      );
      content.userData.content = true;
      content.position.y = 0.01;
      this.ghost.add(content);
    }
    this.ghostMaterial.opacity = valid ? 0.85 : 0.3;
    this.hoverOutline.visible = valid;
    this.hoverDashed.visible = !valid;
    this.refusal.visible = !valid;
    (this.ghostBase.material as THREE.MeshBasicMaterial).opacity = valid ? 0.18 : 0.08;
    preview.sides.forEach((side, index) => {
      const marker = this.markers[index];
      const mark = this.crosses[index];
      if (!marker || !mark) return;
      // Joins are solid teal bars; open path and stream ends are faint bars waiting for a neighbor; refused
      // or steep sides get a cross. Soft differences get no mark.
      const tone =
        side.meet === 'match'
          ? 'match'
          : side.meet === 'blocked' || side.meet === 'steep'
            ? side.meet
            : side.meet === 'open' && (side.edge === 'path' || side.edge === 'water')
              ? 'open'
              : null;
      marker.visible = tone !== null && tone !== 'blocked' && tone !== 'steep';
      mark.visible = tone === 'blocked' || tone === 'steep';
      const angle = edgeAngle(index);
      const d = HEX * 0.78;
      marker.position.set(Math.cos(angle) * d, 0.06, Math.sin(angle) * d);
      marker.rotation.y = -angle + Math.PI / 2;
      mark.position.set(Math.cos(angle) * d, 0.1, Math.sin(angle) * d);
      if (!tone) return;
      const material = marker.material as THREE.MeshBasicMaterial;
      material.color.set(INDICATOR[tone]);
      material.opacity = tone === 'open' ? 0.55 : 0.95;
    });
  }

  /** The current view as a PNG. Renders a fresh frame first, since the drawing buffer is not preserved. */
  capture(): Promise<Blob | null> {
    this.lights.fitFog(this.camera);
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
  }

  hexToScreen(q: number, r: number, elevation = 0): { x: number; y: number } {
    const c = center(q, r);
    const cell = [...this.snapshot.tiles, ...this.snapshot.frontier].find((t) => t.q === q && t.r === r);
    const point = new THREE.Vector3(c.x, (cell?.elevation ?? 0) * LEVEL + 0.01 + elevation, c.z).project(
      this.camera,
    );
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: bounds.left + ((point.x + 1) / 2) * bounds.width,
      y: bounds.top + ((1 - point.y) / 2) * bounds.height,
    };
  }

  setView(view: {
    zoom?: number;
    azimuth?: number;
    polar?: number;
    target?: [number, number, number];
  }): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    if (view.target) this.controls.target.set(...view.target);
    if (view.azimuth !== undefined) spherical.theta = view.azimuth;
    if (view.polar !== undefined) spherical.phi = view.polar;
    spherical.radius = 80;
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

  /** Camera azimuth around the view target, in radians. */
  azimuth(): number {
    return new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target)).theta;
  }

  setLighting(preset: LightingPreset): void {
    this.lighting = preset;
    this.lights.apply(preset);
    this.invalidateShadows();
  }

  /** Sixth-turn orbit, so the view keeps the same relation to the hex lattice; eased unless motion is reduced. */
  rotateView(direction: 1 | -1): void {
    const spherical = new THREE.Spherical().setFromVector3(
      this.camera.position.clone().sub(this.controls.target),
    );
    const start = this.orbitTarget ?? spherical.theta;
    const target = start + (direction * Math.PI) / 3;
    if (this.reducedMotion) this.setView({ azimuth: target });
    else this.orbitTarget = target;
    this.needsRender = true;
  }

  /**
   * Frames the neighborhood and its open spots, a little above the middle of the screen so the tile tray
   * never covers them. Small neighborhoods are seen from a little higher.
   */
  home(instant = false): void {
    const zoom = THREE.MathUtils.clamp((this.span * 0.56) / (this.bounds.radius + 1), MIN_ZOOM, 2.0);
    const polar = HOME_POLAR - 0.06 * Math.max(0, 1 - (this.snapshot.tiles.length - 1) / 8);
    const target = this.bounds.center.clone();
    const { width, height } = this.canvas.getBoundingClientRect();
    const portrait = height > width;
    const visible = (portrait ? this.span / (width / height || 1) : this.span) / zoom;
    // Move the view target toward the viewer, which lifts the island on screen.
    const theta = instant || this.reducedMotion ? HOME_AZIMUTH : this.azimuth();
    const lift = visible * (portrait ? 0.1 : 0.06);
    target.add(new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta)).multiplyScalar(lift / Math.cos(polar)));
    if (instant || this.reducedMotion) {
      this.setView({ target: [target.x, target.y, target.z], azimuth: HOME_AZIMUTH, polar, zoom });
      return;
    }
    this.setView({ target: [target.x, target.y, target.z], polar });
    this.targetZoom = zoom;
    const spherical = new THREE.Spherical().setFromVector3(
      this.camera.position.clone().sub(this.controls.target),
    );
    // Return to the nearest corner-on view rather than spinning back to the original side.
    this.orbitTarget =
      Math.round((spherical.theta - HOME_AZIMUTH) / (Math.PI / 3)) * (Math.PI / 3) + HOME_AZIMUTH;
    this.needsRender = true;
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

  private ring(position: THREE.Vector3): void {
    let slot = this.rings.find((ring) => !ring.mesh.visible);
    if (!slot) {
      if (this.rings.length >= RING_POOL) return;
      const mesh = new THREE.Mesh(
        this.ringGeometry,
        new THREE.MeshBasicMaterial({ color: PALETTE.offWhite, transparent: true, depthWrite: false }),
      );
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      slot = { mesh, start: 0 };
      this.rings.push(slot);
    }
    slot.mesh.visible = true;
    slot.mesh.position.copy(position).setY(position.y + 0.06);
    slot.start = performance.now();
  }

  /** Advances placement, removal, ring, zoom, and orbit easing. Returns true while anything moves. */
  private animate(time: number): boolean {
    let moving = false;
    for (const [id, entry] of this.tiles) {
      if (!entry.born) continue;
      const t = Math.min((time - entry.born) / PLACE_MS, 1);
      const fall = t < 0.62 ? easeOutCubic(t / 0.62) : 1;
      const settle = t < 0.62 ? 0 : Math.sin(((t - 0.62) / 0.38) * Math.PI);
      entry.root.position.copy(entry.base).setY(entry.base.y + (1 - fall) * 0.9);
      entry.root.scale.set(1 + settle * 0.03, 1 - settle * 0.06, 1 + settle * 0.03);
      if (!entry.landed && t >= 0.62) {
        entry.landed = true;
        this.ring(entry.base);
      }
      if (t === 1) {
        entry.born = 0;
        entry.root.scale.setScalar(1);
        entry.root.position.copy(entry.base);
        this.invalidateShadows();
      }
      this.batches.update(id);
      moving = true;
    }
    for (const [id, dying] of this.dying) {
      const t = Math.min((time - dying.start) / REMOVE_MS, 1);
      const shrink = 1 - t * t;
      dying.root.scale.set(shrink, Math.max(shrink, 0.001), shrink);
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
      const t = (time - ring.start) / 560;
      if (t >= 1) {
        ring.mesh.visible = false;
        this.needsRender = true;
        continue;
      }
      const size = HEX * (0.95 + easeOutCubic(t) * 0.35);
      ring.mesh.scale.set(size, 1, size);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t);
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
    // Keep the view over the neighborhood: the target may wander a little past its edge, no further.
    const target = this.controls.target;
    const reach = this.bounds.radius + HEX * 2;
    const dx = target.x - this.bounds.center.x,
      dz = target.z - this.bounds.center.z;
    const distance = Math.hypot(dx, dz);
    if (distance > reach) {
      const pull = new THREE.Vector3(dx, 0, dz).multiplyScalar(reach / distance - 1);
      target.add(pull);
      this.camera.position.add(pull);
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
      const start = this.profile ? performance.now() : 0;
      this.lights.fitFog(this.camera);
      this.renderer.render(this.scene, this.camera);
      if (this.profile) {
        // Reading one pixel waits for the GPU process to finish the frame; finish() alone returns early in Chrome.
        const gl = this.renderer.getContext();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.probePixel);
        if (this.renderMilliseconds.length >= 600) this.renderMilliseconds.shift();
        this.renderMilliseconds.push(performance.now() - start);
      }
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
      environment: {
        candidate: this.environment.kind === 'candidate' ? this.environment.candidate : 'legacy',
        toneMapping: this.environment.toneMapping,
        exposure: this.renderer.toneMappingExposure,
      },
      shadowUpdates: this.shadowUpdates,
      shadowAutoUpdate: this.renderer.shadowMap.autoUpdate,
      shadowNeedsUpdate: this.renderer.shadowMap.needsUpdate,
      frameMs: sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0,
      p95FrameMs: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
      frameSamples: sorted.length,
      renderMs: (() => {
        const r = [...this.renderMilliseconds].sort((a, b) => a - b);
        return r.length ? r[Math.floor(r.length / 2)] : 0;
      })(),
      renderSamples: this.renderMilliseconds.length,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      tiles: this.tiles.size,
      tileParts: this.batches.partCount,
      cachedGeometries: this.kit.size,
      batchCount: this.batches.batchCount,
      allocatedBatchCount: this.batches.allocatedBatchCount,
      groundTriangles: (this.ground.geometry.getAttribute('position')?.count ?? 0) / 3,
      renderObjectCount,
      reconciled: this.reconciled,
      reconcileMs: this.reconcileMilliseconds,
      pixelRatio: this.renderer.getPixelRatio(),
      viewport: { width: this.canvas.width, height: this.canvas.height },
      renderer: this.graphics.renderer,
    };
  }

  dispose(): void {
    if (this.debugRoot) this.debugModule?.disposeDebug(this.debugRoot);
    this.disposed = true;
    cancelAnimationFrame(this.frameRequest);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.batches.dispose();
    this.kit.dispose();
    this.lights.dispose();
    this.ground.geometry.dispose();
    for (const mesh of [this.frontierRims, this.frontierFills, this.blockedRims]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.pickable.dispose();
    this.pickGeometry.dispose();
    this.pickMaterial.dispose();
    this.ghostMaterial.dispose();
    this.ghostBase.geometry.dispose();
    for (const mesh of [this.hoverOutline, this.hoverDashed, this.refusal]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const marker of [...this.markers, ...this.crosses]) (marker.material as THREE.Material).dispose();
    this.markers[0]?.geometry.dispose();
    this.crosses[0]?.geometry.dispose();
    this.ringGeometry.dispose();
    for (const ring of this.rings) (ring.mesh.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
