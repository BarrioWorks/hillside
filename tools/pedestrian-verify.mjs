import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { inventoryErrors } from './pedestrian-inventory.mjs';
import { sceneNames } from './pedestrian-scenes.mjs';

const stage = process.env.BARRIO_PATH_STAGE ?? 'final';
const root = `docs/screenshots/pedestrian/${stage}`;
const scenes = JSON.parse(await readFile('docs/verification/pedestrian/scenes.json', 'utf8'));
const directions = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];
const widths = { primary: 0.56, secondary: 0.34, entrance: 0.24 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const center = (q, r) => ({ x: 3 * q, z: Math.sqrt(3) * 2 * (r + q / 2) });
const validation = {
  source: 'Actual World renderer plans and composed pavement triangles',
  scenes: [],
  passed: false,
};
for (const name of sceneNames) {
  const reports = JSON.parse(await readFile(`${root}/${name}-report.json`, 'utf8'));
  const fixture = scenes.find((s) => s.name === name).snapshot;
  const inventory = inventoryErrors(fixture, reports);
  if (inventory.length) {
    validation.scenes.push({
      name,
      tiles: reports.length,
      doors: 0,
      reachedDoors: 0,
      unservedHomes: [],
      errors: inventory,
      passed: false,
    });
    continue;
  }
  const errors = [],
    unservedHomes = [],
    routeFailures = [],
    classes = { primary: 0, secondary: 0, entrance: 0 };
  const parent = new Map();
  const find = (id) => {
    if (!parent.has(id)) parent.set(id, id);
    let p = id;
    while (parent.get(p) !== p) p = parent.get(p);
    return p;
  };
  const join = (a, b) => parent.set(find(a), find(b));
  const edgeId = (r, id) => `${r.q},${r.r}/${id}`;
  let doors = 0,
    reachedDoors = 0,
    pavingArea = 0,
    pairwiseOverlapArea = 0,
    footprintIntrusionArea = 0,
    waterIntrusionArea = 0,
    seamPairs = 0,
    maxSeamGap = 0;
  for (const r of reports) {
    const graph = r.pedestrian;
    if (!graph) {
      errors.push(`${r.q},${r.r} has no physical graph`);
      continue;
    }
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    if (nodes.size !== graph.nodes.length) errors.push(`${r.q},${r.r} has duplicate node IDs`);
    const seenEdges = new Set();
    for (const e of graph.edges) {
      if (seenEdges.has(e.id)) errors.push(`Duplicate edge ${edgeId(r, e.id)}`);
      seenEdges.add(e.id);
      const a = nodes.get(e.from),
        b = nodes.get(e.to);
      if (!a || !b) {
        errors.push(`Missing endpoints ${edgeId(r, e.id)}`);
        continue;
      }
      if (a.group !== e.group || b.group !== e.group) errors.push(`Mixed groups ${edgeId(r, e.id)}`);
      if (!(e.class in widths) || Math.abs(e.width - widths[e.class]) > 1e-9)
        errors.push(`Wrong width ${edgeId(r, e.id)}`);
      if (distance(a.at, b.at) < 1e-7) errors.push(`Zero length ${edgeId(r, e.id)}`);
      if (!e.purpose) errors.push(`No purpose ${edgeId(r, e.id)}`);
      if (e.class === 'secondary' && !(e.purpose.kind === 'entrances' && e.purpose.doors.length >= 2))
        errors.push(`Unshared secondary ${edgeId(r, e.id)}`);
      classes[e.class]++;
      join(edgeId(r, e.from), edgeId(r, e.to));
    }
    for (const n of graph.nodes) {
      const expected = graph.edges
        .filter((e) => e.from === n.id || e.to === n.id)
        .map((e) => e.id)
        .sort();
      if (JSON.stringify([...(graph.adjacency[n.id] ?? [])].sort()) !== JSON.stringify(expected))
        errors.push(`Adjacency disagrees ${edgeId(r, n.id)}`);
      if (expected.length === 1 && n.kind === 'junction')
        errors.push(`Junction has no destination ${edgeId(r, n.id)}`);
      if (expected.length === 0 && n.kind === 'destination')
        errors.push(`Public destination is isolated ${edgeId(r, n.id)}`);
    }
    for (const group of new Set(graph.edges.map((e) => e.group))) {
      const edges = graph.edges.filter((e) => e.group === group),
        active = new Set(edges.flatMap((e) => [e.from, e.to]));
      const components = new Set([...active].map((id) => find(edgeId(r, id))));
      if (edges.length > active.size - components.size)
        errors.push(`Unnecessary local loop ${r.q},${r.r}/${group}`);
    }
    for (const f of graph.failures) {
      routeFailures.push({ tile: [r.q, r.r], ...f });
      if (f.group != null) errors.push(`Failed required route ${r.q},${r.r}/${f.side}: ${f.reason}`);
    }
    const tile = fixture.tiles.find((t) => t.q === r.q && t.r === r.r);
    for (const h of r.homes) {
      doors++;
      const group = h.public ? h.group : tile.entrances[h.side];
      const door = graph.nodes.find((n) => n.kind === 'door' && n.side === h.side);
      if (group == null) {
        if (!door) errors.push(`Unserved door anchor missing ${r.q},${r.r}/${h.side}`);
        if (h.connected || (door && (door.group !== 0 || graph.adjacency[door.id]?.length)))
          errors.push(`Pathless home has fabricated service ${r.q},${r.r}/${h.side}`);
        if (!graph.failures.some((f) => f.side === h.side && f.group === null))
          errors.push(`Unserved home lacks diagnostic ${r.q},${r.r}/${h.side}`);
        unservedHomes.push({
          tile: [r.q, r.r],
          side: h.side,
          reason: 'Tile has no rule entrance or pedestrian crossing',
        });
        continue;
      }
      if (!door) {
        errors.push(`Required door missing ${r.q},${r.r}/${h.side}`);
        continue;
      }
      if (door.public !== h.public || door.group !== group)
        errors.push(`Door role or service group disagrees ${r.q},${r.r}/${h.side}`);
      if (distance(door.at, h.door) > 1e-6) errors.push(`Door anchor drift ${r.q},${r.r}/${h.side}`);
      const threshold = graph.edges.find(
        (e) =>
          (e.from === door.id || e.to === door.id) && e.purpose.kind === 'entrances' && e.purpose.threshold,
      );
      const exit = threshold && nodes.get(threshold.from === door.id ? threshold.to : threshold.from);
      if (!exit) errors.push(`Missing aligned entrance approach ${r.q},${r.r}/${h.side}`);
      else {
        const length = distance(door.at, exit.at),
          heading = door.anchor.heading;
        const alignment =
          ((exit.at.x - door.at.x) * heading.x + (exit.at.z - door.at.z) * heading.z) / length;
        if (alignment < 0.9998) errors.push(`Entrance is not aligned ${r.q},${r.r}/${h.side}`);
      }
      const crossings = graph.nodes.filter((n) => n.kind === 'crossing' && n.group === door.group);
      if (crossings.some((n) => find(edgeId(r, n.id)) === find(edgeId(r, door.id)))) reachedDoors++;
      else errors.push(`Door cannot reach a crossing ${r.q},${r.r}/${h.side}`);
    }
    for (const group of new Set(graph.nodes.filter((n) => n.kind === 'crossing').map((n) => n.group))) {
      const crossings = graph.nodes.filter(
        (n) => n.kind === 'crossing' && n.location === 'interior' && n.group === group,
      );
      if (crossings.length > 1 && new Set(crossings.map((n) => find(edgeId(r, n.id)))).size !== 1)
        errors.push(`Split primary group ${r.q},${r.r}/${group}`);
    }
    pavingArea += r.geometry.area;
    pairwiseOverlapArea += r.geometry.overlapArea;
    footprintIntrusionArea += r.geometry.blockedArea;
    waterIntrusionArea += r.geometry.waterIntrusionArea ?? 0;
    if (r.geometry.outsideVertices) errors.push(`Pavement leaves terrain ${r.q},${r.r}`);
    if (r.geometry.coverageGaps?.length)
      errors.push(
        `Graph has ${r.geometry.coverageGaps.length} missing full-width pavement samples at ${r.q},${r.r}`,
      );
    if (r.geometry.terrainContactGaps?.length)
      errors.push(
        `Pavement has ${r.geometry.terrainContactGaps.length} incorrect terrain or stair heights at ${r.q},${r.r}`,
      );
  }
  for (const r of reports) {
    if (!r.pedestrian) continue;
    const tile = fixture.tiles.find((t) => t.q === r.q && t.r === r.r);
    for (const b of r.pedestrian.boundaries) {
      if (tile.meets[b.side] !== 'match' || tile.edges[b.side] !== 'path') continue;
      const [dq, dr] = directions[b.side];
      const other = reports.find((n) => n.q === r.q + dq && n.r === r.r + dr);
      const peer = other?.pedestrian?.boundaries.find((n) => n.side === (b.side + 3) % 6);
      if (!other || !peer) {
        errors.push(`Missing matched boundary peer ${r.q},${r.r}/${b.side}`);
        continue;
      }
      const n = r.pedestrian.nodes.find(
        (n) => n.kind === 'crossing' && n.location === 'boundary' && n.side === b.side,
      );
      const m = other.pedestrian.nodes.find(
        (n) => n.kind === 'crossing' && n.location === 'boundary' && n.side === (b.side + 3) % 6,
      );
      if (!n || !m) {
        errors.push(`Missing matched crossing ${r.q},${r.r}/${b.side}`);
        continue;
      }
      const c = center(r.q, r.r),
        d = center(other.q, other.r),
        otherTile = fixture.tiles.find((t) => t.q === other.q && t.r === other.r);
      const gap = Math.hypot(
        c.x + n.at.x - d.x - m.at.x,
        c.z + n.at.z - d.z - m.at.z,
        tile.elevation * 0.6 + n.height - otherTile.elevation * 0.6 - m.height,
      );
      maxSeamGap = Math.max(maxSeamGap, gap);
      seamPairs++;
      if (gap > 1e-6) errors.push(`Seam gap ${r.q},${r.r}/${b.side} is ${gap}`);
      join(edgeId(r, n.id), edgeId(other, m.id));
    }
  }
  const physicalToLogical = new Map(),
    logicalToPhysical = new Map();
  for (const r of reports) {
    if (!r.pedestrian) continue;
    const tile = fixture.tiles.find((t) => t.q === r.q && t.r === r.r);
    for (const n of r.pedestrian.nodes) {
      if (n.kind !== 'crossing' || n.location !== 'interior' || !r.pedestrian.adjacency[n.id]?.length)
        continue;
      const component = find(edgeId(r, n.id)),
        network = tile.networks[n.side];
      if (network == null) {
        errors.push(`Active crossing has no logical network ${r.q},${r.r}/${n.side}`);
        continue;
      }
      if (!physicalToLogical.has(component)) physicalToLogical.set(component, new Set());
      physicalToLogical.get(component).add(network);
      if (!logicalToPhysical.has(network)) logicalToPhysical.set(network, new Set());
      logicalToPhysical.get(network).add(component);
    }
  }
  for (const [component, networks] of physicalToLogical)
    if (networks.size > 1) errors.push(`Physical component ${component} mixes logical networks`);
  for (const [network, components] of logicalToPhysical)
    if (components.size > 1) errors.push(`Logical network ${network} has disconnected physical routes`);
  if (pairwiseOverlapArea > 1e-6) errors.push(`Pairwise pavement overlap ${pairwiseOverlapArea}`);
  if (footprintIntrusionArea > 1e-6) errors.push(`Pavement enters footprints by ${footprintIntrusionArea}`);
  if (waterIntrusionArea > 1e-6) errors.push(`Pavement enters water or banks by ${waterIntrusionArea}`);
  if (name === 'B-five-houses' && classes.secondary === 0)
    errors.push('Five houses have no shared secondary branch');
  validation.scenes.push({
    name,
    tiles: reports.length,
    doors,
    reachedDoors,
    unservedHomes,
    classes,
    pavingArea,
    pairwiseOverlapArea,
    footprintIntrusionArea,
    waterIntrusionArea,
    seamPairs: seamPairs / 2,
    maxSeamGap,
    routeFailures,
    errors,
    passed: errors.length === 0,
  });
}
validation.passed = validation.scenes.every((s) => s.passed);
await writeFile(
  `docs/verification/pedestrian/validation${stage === 'final' ? '' : `-${stage}`}.json`,
  JSON.stringify(validation, null, 2),
);
for (const s of validation.scenes)
  console.log(
    `${s.passed ? 'PASS' : 'FAIL'} ${s.name}: ${s.reachedDoors}/${s.doors} doors, ${s.errors.length} errors, ${s.unservedHomes.length} explicitly unserved homes`,
  );
assert(
  validation.passed,
  'Pedestrian rendering acceptance failed; inspect docs/verification/pedestrian/validation.json',
);
