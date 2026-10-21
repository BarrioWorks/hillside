import * as THREE from 'three';
import type { Snapshot } from '../domain';
import { center, corner, DIRECTIONS, edgeAngle, INRADIUS, key, LEVEL } from './hex';
import type { Point, SideState, TilePlan, TileSite } from './tiles';

export const DEBUG_LIFT = 0.09;
const ORDER = 1000;
const STATUS = { differ: '#ff9500', steep: '#ff3030', open: '#999999', blocked: '#ff9500' };

export function networkColor(id: number | null | undefined): THREE.Color {
  return id == null
    ? new THREE.Color('#999999')
    : new THREE.Color().setHSL(((((id + 1) * 0.61803398875) % 1) + 1) % 1, 0.85, 0.55);
}

export function buildDebug(
  snapshot: Snapshot,
  layout: (site: TileSite, sides: SideState[]) => TilePlan,
  labels = true,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'connectivity-debug';
  const byKey = new Map(snapshot.tiles.map((tile) => [key(tile.q, tile.r), tile]));
  const texts = new Map<string, THREE.SpriteMaterial>();
  const line = (parent: THREE.Group, points: Point[], color: THREE.ColorRepresentation) => {
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
    );
    const item = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false }),
    );
    parent.add(item);
    return item;
  };
  const dot = (parent: THREE.Group, at: Point, color: THREE.ColorRepresentation, radius = 0.065) => {
    const item = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
    );
    item.position.set(at.x, 0.008, at.z);
    parent.add(item);
    return item;
  };
  const label = (parent: THREE.Group, value: string, at: Point, color = '#ffffff') => {
    if (!labels) return;
    const cacheKey = `${value}/${color}`;
    let material = texts.get(cacheKey);
    if (!material) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = '#15202bd9';
      context.fillRect(0, 0, 256, 64);
      context.font = 'bold 40px monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = color;
      context.fillText(value, 128, 32);
      material = new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: true,
      });
      texts.set(cacheKey, material);
    }
    const sprite = new THREE.Sprite(material);
    sprite.position.set(at.x, 0.15, at.z);
    sprite.scale.set(value === 'MISMATCH' ? 0.95 : 0.5, 0.16, 1);
    parent.add(sprite);
  };
  for (const tile of snapshot.tiles) {
    const tileRoot = new THREE.Group();
    const c = center(tile.q, tile.r);
    tileRoot.position.set(c.x, tile.elevation * LEVEL + DEBUG_LIFT, c.z);
    tileRoot.userData = { q: tile.q, r: tile.r };
    root.add(tileRoot);
    const sides = DIRECTIONS.map((d, side) => ({
      meet: tile.meets[side] ?? 'open',
      rise: (byKey.get(key(tile.q + d.q, tile.r + d.r))?.elevation ?? tile.elevation) - tile.elevation,
    }));
    const plan = layout({ ...tile, region: snapshot.region }, sides);
    line(
      tileRoot,
      Array.from({ length: 7 }, (_, i) => corner(i % 6)),
      '#b6c5d0',
    );
    for (let side = 0; side < 6; side++) {
      const a = edgeAngle(side);
      label(tileRoot, String(side), {
        x: Math.cos(a) * (INRADIUS - 0.22),
        z: Math.sin(a) * (INRADIUS - 0.22),
      });
    }
    for (const walk of plan.walks) {
      const network = tile.networks[walk.sides[0] ?? 0];
      const color = networkColor(network);
      for (const curve of walk.curves) line(tileRoot, curve, color);
      const middle = walk.hub ?? walk.curves[0]?.[Math.floor((walk.curves[0]?.length ?? 0) / 2)];
      if (middle) {
        if (walk.hub) dot(tileRoot, middle, color, 0.12);
        label(tileRoot, `N${network ?? '∅'}`, middle);
      }
      walk.sides.forEach((side, index) => {
        // Two-sided walks share one curve: the second side ends at its last sample.
        const at = walk.sides.length === 2 && index === 1 ? walk.curves[0]?.at(-1) : walk.curves[index]?.[0];
        if (!at) return;
        const endpoint = dot(tileRoot, at, color);
        endpoint.userData = { kind: 'path-endpoint', side, network };
        const meet = tile.meets[side];
        if (meet && meet !== 'match') {
          const mark = line(
            tileRoot,
            Array.from({ length: 25 }, (_, i) => ({
              x: at.x + Math.cos((i * Math.PI) / 12) * 0.11,
              z: at.z + Math.sin((i * Math.PI) / 12) * 0.11,
            })),
            STATUS[meet],
          );
          mark.userData = { kind: meet, side };
        }
        const d = DIRECTIONS[side];
        const other = d && byKey.get(key(tile.q + d.q, tile.r + d.r));
        if (
          meet === 'match' &&
          other?.edges[(side + 3) % 6] === 'path' &&
          other.networks[(side + 3) % 6] !== tile.networks[side]
        ) {
          const mark = dot(tileRoot, at, '#ff00ff', 0.16);
          mark.userData = { kind: 'mismatch', side };
          label(tileRoot, 'MISMATCH', at, '#ff00ff');
        }
      });
    }
    for (const home of plan.homes) {
      const connected = home.connected && tile.networks[home.side] != null;
      const anchor = dot(tileRoot, home.door, '#ffffff');
      anchor.userData = { kind: 'door', side: home.side };
      if (home.access) line(tileRoot, home.access, '#70efac');
      const at = home.door;
      if (connected) {
        const ring = line(
          tileRoot,
          Array.from({ length: 25 }, (_, i) => ({
            x: at.x + Math.cos((i * Math.PI) / 12) * 0.14,
            z: at.z + Math.sin((i * Math.PI) / 12) * 0.14,
          })),
          '#40ff88',
        );
        ring.userData = { kind: 'connected', side: home.side };
      } else {
        const cross = new THREE.Group();
        cross.userData = { kind: 'disconnected', side: home.side };
        tileRoot.add(cross);
        for (const sign of [-1, 1])
          line(
            cross,
            [
              { x: at.x - 0.13, z: at.z - sign * 0.13 },
              { x: at.x + 0.13, z: at.z + sign * 0.13 },
            ],
            '#ff3030',
          );
      }
    }
  }
  root.traverse((item) => {
    item.renderOrder = ORDER;
  });
  return root;
}

export function disposeDebug(root: THREE.Group): void {
  const materials = new Set<THREE.Material>();
  root.traverse((item) => {
    if (item instanceof THREE.Mesh || item instanceof THREE.Line) item.geometry.dispose();
    if (item instanceof THREE.Mesh || item instanceof THREE.Line || item instanceof THREE.Sprite) {
      for (const material of Array.isArray(item.material) ? item.material : [item.material])
        materials.add(material);
    }
  });
  for (const material of materials) {
    if (material instanceof THREE.SpriteMaterial) material.map?.dispose();
    material.dispose();
  }
  root.removeFromParent();
}
