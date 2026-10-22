import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildDebug, disposeDebug } from '../src/render/debug';
import { DIRECTIONS, key } from '../src/render/hex';
import { Surface } from '../src/render/palette';
import { TileKit } from '../src/render/tiles';
import { realCore } from './core-fixture';

describe('connectivity overlay from real runs', () => {
  it.each([1, 2, 3, 4, 5])(
    'agrees with graph crossings, pavement, networks and doors for seed %i',
    (seed) => {
      const snapshot = realCore(seed).command({ type: 'autoplay', count: 30 }).snapshot;
      const kit = new TileKit();
      const byKey = new Map(snapshot.tiles.map((tile) => [key(tile.q, tile.r), tile]));
      const overlay = buildDebug(snapshot, (site, sides) => kit.plan(site, sides), false);
      let endpoints = 0;
      let homes = 0;
      snapshot.tiles.forEach((tile, index) => {
        const group = overlay.children[index];
        expect(group).toBeDefined();
        if (!group) return;
        const sides = DIRECTIONS.map((d, side) => ({
          meet: tile.meets[side] ?? 'open',
          rise: (byKey.get(key(tile.q + d.q, tile.r + d.r))?.elevation ?? tile.elevation) - tile.elevation,
        }));
        const site = { ...tile, region: snapshot.region };
        const plan = kit.plan(site, sides);
        const parts = kit.compose(site, sides);
        for (const node of plan.pedestrian.nodes) {
          if (node.kind !== 'crossing' || node.location !== 'boundary') continue;
          const side = node.side;
          const at = node.at;
          const dot = group.children.find(
            (child) => child.userData.kind === 'path-endpoint' && child.userData.side === side,
          );
          expect(dot?.position.x).toBe(at?.x);
          expect(dot?.position.z).toBe(at?.z);
          if (!(plan.pedestrian.adjacency[node.id]?.length ?? 0)) continue;
          // A ribbon end has paving vertices on both sides of its centerline endpoint.
          const vertices: THREE.Vector3[] = [];
          for (const part of parts) {
            const positions = part.geometry.getAttribute('position');
            const surfaces = part.geometry.getAttribute('surface');
            for (let v = 0; v < positions.count; v++) {
              if (surfaces.getX(v) !== Surface.paving) continue;
              const p = new THREE.Vector3().fromBufferAttribute(positions, v).applyMatrix4(part.matrix);
              if (Math.abs(Math.hypot(p.x - at.x, p.z - at.z) - 0.28) < 0.001) vertices.push(p);
            }
          }
          expect(
            vertices.some((a) =>
              vertices.some((b) => Math.hypot((a.x + b.x) / 2 - at.x, (a.z + b.z) / 2 - at.z) < 0.001),
            ),
          ).toBe(true);
          const d = DIRECTIONS[side];
          const other = d && byKey.get(key(tile.q + d.q, tile.r + d.r));
          if (tile.meets[side] === 'match' && other?.edges[(side + 3) % 6] === 'path')
            expect(tile.networks[side]).toBe(other.networks[(side + 3) % 6]);
          endpoints++;
        }
        expect(group.children.filter((child) => child.userData.kind === 'path-endpoint')).toHaveLength(
          tile.edges.filter((e) => e === 'path').length,
        );
        for (const home of plan.homes) {
          const door = group.children.find(
            (child) => child.userData.kind === 'door' && child.userData.side === home.side,
          );
          expect(door?.position.x).toBe(home.door.x);
          expect(door?.position.z).toBe(home.door.z);
          const kind = home.connected ? 'connected' : 'disconnected';
          expect(
            group.children.some((child) => child.userData.kind === kind && child.userData.side === home.side),
          ).toBe(true);
          homes++;
        }
      });
      overlay.traverse((item) => expect(item.userData.kind).not.toBe('mismatch'));
      expect(endpoints).toBeGreaterThan(0);
      expect(homes).toBeGreaterThan(0);
      disposeDebug(overlay);
      kit.dispose();
    },
  );
});
