export function expectedHomes(tile) {
  const landmark = tile.kind === 'capilla' ? tile.edges.indexOf('nature') : -1;
  return tile.edges.flatMap((edge, side) =>
    edge === 'homes' || side === landmark
      ? [
          {
            side,
            public: side === landmark,
            group: side === landmark ? (tile.paths.find((group) => group > 0) ?? null) : tile.entrances[side],
          },
        ]
      : [],
  );
}
export function inventoryErrors(fixture, reports) {
  const errors = [];
  if (!Array.isArray(reports)) return ['Scene report must be an array'];
  const expected = new Map(fixture.tiles.map((tile) => [`${tile.q},${tile.r}`, tile]));
  const seen = new Set();
  for (const r of reports) {
    const key = `${r?.q},${r?.r}`,
      tile = expected.get(key);
    if (!tile) {
      errors.push(`Unexpected tile ${key}`);
      continue;
    }
    if (seen.has(key)) errors.push(`Duplicate tile ${key}`);
    seen.add(key);
    if (!Array.isArray(r.homes)) {
      errors.push(`Missing home inventory ${key}`);
      continue;
    }
    const homes = expectedHomes(tile),
      sides = new Set();
    for (const h of r.homes) {
      const home = homes.find((n) => n.side === h.side);
      if (!home) {
        errors.push(`Unexpected home ${key}/${h.side}`);
        continue;
      }
      if (sides.has(h.side)) errors.push(`Duplicate home ${key}/${h.side}`);
      sides.add(h.side);
      if (h.group !== home.group) errors.push(`Home service group disagrees with fixture ${key}/${h.side}`);
      if (h.public !== home.public) errors.push(`Home role disagrees with fixture ${key}/${h.side}`);
      if (!Number.isFinite(h.door?.x) || !Number.isFinite(h.door?.z) || typeof h.connected !== 'boolean')
        errors.push(`Missing door metadata ${key}/${h.side}`);
    }
    for (const h of homes) if (!sides.has(h.side)) errors.push(`Missing home ${key}/${h.side}`);
    for (const field of [
      'triangles',
      'area',
      'overlapArea',
      'blockedArea',
      'waterIntrusionArea',
      'degenerate',
      'outsideVertices',
    ])
      if (!Number.isFinite(r.geometry?.[field]) || r.geometry[field] < 0)
        errors.push(`Missing geometry field ${key}/${field}`);
    for (const field of ['coverageGaps', 'terrainContactGaps'])
      if (!Array.isArray(r.geometry?.[field])) errors.push(`Missing geometry field ${key}/${field}`);
    for (const field of ['nodes', 'edges', 'walkable', 'blocked', 'boundaries', 'failures'])
      if (!Array.isArray(r.pedestrian?.[field])) errors.push(`Missing graph field ${key}/${field}`);
    if (!r.pedestrian?.adjacency || typeof r.pedestrian.adjacency !== 'object')
      errors.push(`Missing graph adjacency ${key}`);
    const graph = r.pedestrian;
    if (Array.isArray(graph?.nodes) && Array.isArray(graph?.boundaries) && Array.isArray(graph?.edges)) {
      for (let side = 0; side < 6; side++) {
        const group = tile.paths[side];
        if (tile.edges[side] !== 'path' || !(group > 0)) continue;
        for (const location of ['interior', 'boundary']) {
          const nodes = graph.nodes.filter(
            (n) => n.kind === 'crossing' && n.side === side && n.location === location,
          );
          if (nodes.length !== 1 || nodes[0].group !== group)
            errors.push(`Missing or incorrect ${location} crossing ${key}/${side}`);
        }
        const ports = graph.boundaries.filter((b) => b.side === side);
        if (ports.length !== 1 || ports[0].group !== group)
          errors.push(`Missing or incorrect boundary contract ${key}/${side}`);
        const required =
          tile.meets?.[side] === 'match' || graph.edges.some((e) => e.interior && e.group === group);
        if (
          required &&
          !graph.edges.some(
            (e) => e.group === group && e.purpose?.kind === 'boundary' && e.purpose.side === side,
          )
        )
          errors.push(`Missing required boundary adapter ${key}/${side}`);
      }
      const groups = new Set(tile.paths.filter((g) => g > 0));
      for (const group of groups) {
        if (
          tile.paths.filter((g) => g === group).length > 1 &&
          !graph.edges.some((e) => e.interior && e.group === group)
        )
          errors.push(`Missing required primary route ${key}/${group}`);
      }
      if (graph.edges.length && (!(r.geometry?.triangles > 0) || !(r.geometry?.area > 0)))
        errors.push(`Missing pavement for routed graph ${key}`);
      if (graph.walkable?.length !== 6) errors.push(`Missing walkable hex ${key}`);
    }
  }
  for (const key of expected.keys()) if (!seen.has(key)) errors.push(`Missing tile ${key}`);
  return errors;
}
