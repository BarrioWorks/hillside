export const sceneNames = ['A-two-houses', 'B-five-houses', 'C-three-hexagons', 'D-hillside', 'E-settlement'];
const directions = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];
function tile(q, r, edges, elevation = 0, variation = 0) {
  const paths = edges.map((e) => (e === 'path' ? 1 : 0));
  const entrances = edges.map((e, side) => {
    if (e !== 'homes') return null;
    for (let d = 1; d <= 3; d++) for (const s of [(side + 6 - d) % 6, (side + d) % 6]) if (paths[s]) return 1;
    return null;
  });
  return {
    q,
    r,
    kind: 'casas',
    family: 'residential',
    edges,
    paths,
    entrances,
    networks: edges.map((e) => (e === 'path' || e === 'homes' ? 0 : null)),
    meets: edges.map(() => 'open'),
    rotation: 0,
    variation,
    elevation,
  };
}
export function pedestrianScene(name, base, settlement) {
  const through = ['path', 'homes', 'nature', 'path', 'homes', 'nature'];
  const definitions = {
    'A-two-houses': [tile(0, 0, ['homes', 'path', 'homes', 'nature', 'nature', 'nature'])],
    'B-five-houses': [tile(0, 0, ['path', 'homes', 'homes', 'homes', 'homes', 'homes'])],
    'C-three-hexagons': [tile(0, 0, through), tile(1, 0, through, 0, 3), tile(2, 0, through, 0, 7)],
    'D-hillside': [tile(0, 0, through), tile(1, 0, through, 1, 3), tile(2, 0, through, 2, 7)],
    'E-settlement': settlement.tiles,
  };
  const tiles = structuredClone(definitions[name]);
  if (!tiles) throw new Error(`Unknown pedestrian scene ${name}`);
  if (name !== 'E-settlement')
    for (const t of tiles)
      t.meets = directions.map(([q, r], side) => {
        const n = tiles.find((n) => n.q === t.q + q && n.r === t.r + r);
        return !n ? 'open' : t.edges[side] === n.edges[(side + 3) % 6] ? 'match' : 'differ';
      });
  return {
    ...structuredClone(base),
    seed: 909352,
    region: 'medellin',
    tiles,
    frontier: [],
    current: null,
    upcoming: [],
    placements: tiles.length - 1,
    revision: base.revision + sceneNames.indexOf(name) + 1,
  };
}

export function uphillFiveHouseScene(snapshot) {
  const copy = structuredClone(snapshot),
    house = copy.tiles[0];
  if (house?.edges[0] !== 'path') throw new Error('Five-house expansion requires its side-zero crossing');
  house.meets[0] = 'match';
  const neighbor = tile(
    house.q + 1,
    house.r,
    ['nature', 'nature', 'nature', 'path', 'nature', 'nature'],
    house.elevation + 1,
    7,
  );
  neighbor.kind = 'sendero';
  neighbor.family = 'landscape';
  neighbor.meets[3] = 'match';
  copy.tiles.push(neighbor);
  copy.revision++;
  return copy;
}
