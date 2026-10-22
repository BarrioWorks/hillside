import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  inspectTriangles,
  intersectionArea,
  pavementCoverage,
  terrainContactGaps,
} from './pedestrian-geometry.mjs';

const triangle = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
];
test('detects coincident faces and ignores shared mesh edges', () => {
  assert.equal(inspectTriangles([triangle, triangle]).overlapArea, 0.5);
  const adjacent = [
    { x: 1, z: 0 },
    { x: 1, z: 1 },
    { x: 0, z: 1 },
  ];
  assert.equal(inspectTriangles([triangle, adjacent]).overlapArea, 0);
});
test('measures partial overlap independently of winding', () => {
  const shifted = triangle.map(({ x, z }) => ({ x: x + 0.5, z }));
  assert.equal(intersectionArea(triangle, shifted), 0.125);
  assert.equal(intersectionArea(triangle, [...shifted].reverse()), 0.125);
});
test('finds crossings whose triangle vertices are outside the blocker', () => {
  const blocker = [
    { x: 0.4, z: -1 },
    { x: 0.6, z: -1 },
    { x: 0.6, z: 1 },
    { x: 0.4, z: 1 },
  ];
  assert(Math.abs(intersectionArea(triangle, blocker) - 0.1) < 1e-12);
});
test('rejects a graph whose mesh has lost one side of its required width', () => {
  const graph = {
    nodes: [
      { id: 'a', at: { x: 0.1, z: 0.2 } },
      { id: 'b', at: { x: 0.7, z: 0.2 } },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', width: 0.2, traversal: { kind: 'level', height: 0 } }],
  };
  assert.equal(pavementCoverage([triangle.map((p) => ({ ...p, y: 0.045 }))], graph).length, 0);
  const clipped = [
    { x: 0, z: 0.2, y: 0.045 },
    { x: 1, z: 0.2, y: 0.045 },
    { x: 0, z: 1, y: 0.045 },
  ];
  assert(pavementCoverage([clipped], graph).length > 0);
  assert(
    pavementCoverage(
      [
        [
          { x: 0, z: 0, y: 0.045 },
          { x: 0, z: 0, y: 0.045 },
          { x: 0, z: 0, y: 0.045 },
        ],
      ],
      graph,
    ).length > 0,
  );
});
test('detects floating pavement and checks the actual tread height', () => {
  const graph = {
    nodes: [
      { id: 'a', at: { x: 0, z: 0 } },
      { id: 'b', at: { x: 1, z: 0 } },
    ],
    edges: [],
  };
  assert.equal(terrainContactGaps([triangle.map((p) => ({ ...p, y: 0.045 }))], graph).length, 0);
  assert.equal(terrainContactGaps([triangle.map((p) => ({ ...p, y: 0.2 }))], graph).length, 1);
  graph.edges.push({
    from: 'a',
    to: 'b',
    width: 0.4,
    traversal: { kind: 'stairs', fromHeight: 0, toHeight: 0.6, steps: 3 },
  });
  const tread = [
    { x: 0, z: -0.1, y: 0.245 },
    { x: 0.3, z: -0.1, y: 0.245 },
    { x: 0, z: 0.1, y: 0.245 },
  ];
  assert.equal(terrainContactGaps([tread], graph).length, 0);
  assert.equal(terrainContactGaps([tread.map((p) => ({ ...p, y: 0.045 }))], graph).length, 1);
});
test('does not let correct stair treads stand in for a missing level route', () => {
  const graph = {
    nodes: [
      { id: 'a', at: { x: 0, z: 0 } },
      { id: 'b', at: { x: 1, z: 0 } },
    ],
    edges: [
      { id: 'level', from: 'a', to: 'b', width: 0.2, traversal: { kind: 'level', height: 0 } },
      {
        id: 'stairs',
        from: 'a',
        to: 'b',
        width: 0.2,
        traversal: { kind: 'stairs', fromHeight: 0, toHeight: 0.6, steps: 3 },
      },
    ],
  };
  const triangles = [];
  for (let step = 0; step < 3; step++) {
    const a = step / 3,
      b = (step + 1) / 3,
      y = (step + 1) * 0.2 + 0.045;
    const p = [
      { x: a, z: -0.1, y },
      { x: b, z: -0.1, y },
      { x: b, z: 0.1, y },
      { x: a, z: 0.1, y },
    ];
    triangles.push([p[0], p[1], p[2]], [p[0], p[2], p[3]]);
  }
  assert.equal(terrainContactGaps(triangles, graph).length, 0);
  assert(pavementCoverage(triangles, graph).some((gap) => gap.edge === 'level'));
});
test('finds a narrow missing strip between the sampled positions', () => {
  const graph = {
    nodes: [
      { id: 'a', at: { x: 0, z: 0 } },
      { id: 'b', at: { x: 1, z: 0 } },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', width: 0.2, traversal: { kind: 'level', height: 0 } }],
  };
  const triangles = [];
  for (const [a, b] of [
    [0, 0.35],
    [0.36, 1],
  ]) {
    const points = [
      { x: a, z: -0.1, y: 0.045 },
      { x: b, z: -0.1, y: 0.045 },
      { x: b, z: 0.1, y: 0.045 },
      { x: a, z: 0.1, y: 0.045 },
    ];
    triangles.push([points[0], points[1], points[2]], [points[0], points[2], points[3]]);
  }
  const gaps = pavementCoverage(triangles, graph);
  assert.equal(gaps.filter((gap) => 't' in gap).length, 0);
  assert(gaps.some((gap) => gap.missingArea > 0.001));
});
