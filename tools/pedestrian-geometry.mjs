const EPSILON = 1e-9;
const cross = (a, b, p) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
export function pavingTriangles(parts, pavingSurface) {
  const triangles = [];
  for (const part of parts) {
    const g = part.geometry,
      positions = g.getAttribute('position'),
      surfaces = g.getAttribute('surface'),
      normals = g.getAttribute('normal'),
      m = part.matrix.elements;
    for (let i = 0; i < (g.index?.count ?? positions.count); i += 3) {
      const ids = [0, 1, 2].map((j) => (g.index ? g.index.getX(i + j) : i + j));
      if (!ids.every((id) => surfaces.getX(id) === pavingSurface && normals.getY(id) > 0.9)) continue;
      const points = ids.map((id) => {
        const x = positions.getX(id),
          y = positions.getY(id),
          z = positions.getZ(id);
        return {
          x: m[0] * x + m[4] * y + m[8] * z + m[12],
          y: m[1] * x + m[5] * y + m[9] * z + m[13],
          z: m[2] * x + m[6] * y + m[10] * z + m[14],
        };
      });
      if (Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)) <= 1e-6)
        triangles.push(points);
    }
  }
  return triangles;
}
export function polygonArea(points) {
  return (
    Math.abs(
      points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p.x * q.z - q.x * p.z;
      }, 0),
    ) / 2
  );
}
export function intersectionArea(subject, clip) {
  let polygon = subject;
  const signed = clip.reduce((sum, p, i) => {
    const q = clip[(i + 1) % clip.length];
    return sum + p.x * q.z - q.x * p.z;
  }, 0);
  const orientation = signed < 0 ? -1 : 1;
  for (let side = 0; side < clip.length && polygon.length; side++) {
    const a = clip[side],
      b = clip[(side + 1) % clip.length],
      input = polygon;
    polygon = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i],
        q = input[(i + 1) % input.length];
      const dp = orientation * cross(a, b, p),
        dq = orientation * cross(a, b, q);
      if (dp >= -EPSILON) polygon.push(p);
      if ((dp > EPSILON && dq < -EPSILON) || (dp < -EPSILON && dq > EPSILON)) {
        const t = dp / (dp - dq);
        polygon.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      }
    }
  }
  return polygon.length >= 3 ? polygonArea(polygon) : 0;
}
function surfaceHeight(edge, t) {
  const traversal = edge.traversal;
  if (traversal.kind === 'level') return traversal.height + 0.045;
  const low = Math.min(traversal.fromHeight, traversal.toHeight);
  const high = Math.max(traversal.fromHeight, traversal.toHeight);
  const fraction = traversal.toHeight > traversal.fromHeight ? t : 1 - t;
  const step = Math.max(1, Math.min(traversal.steps, Math.ceil(fraction * traversal.steps - 1e-6)));
  return low + ((high - low) * step) / traversal.steps + 0.045;
}
export function pavementCoverage(triangles, graph) {
  const contains = (p, t) => {
    if (polygonArea(t) < 1e-10) return false;
    const signs = t.map((a, i) => cross(a, t[(i + 1) % 3], p));
    return signs.every((v) => v >= -1e-7) || signs.every((v) => v <= 1e-7);
  };
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const gaps = [];
  for (const e of graph.edges) {
    const a = nodes.get(e.from)?.at,
      b = nodes.get(e.to)?.at;
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-8) continue;
    const dx = -(b.z - a.z) / length,
      dz = (b.x - a.x) / length;
    const atHeight = (triangle, height) =>
      triangle.every((p) => Number.isFinite(p.y) && Math.abs(p.y - height) < 1e-5);
    for (const t of [0.001, 0.25, 0.5, 0.75, 0.999])
      for (const offset of [-e.width / 2 + 1e-5, 0, e.width / 2 - 1e-5]) {
        const p = { x: a.x + (b.x - a.x) * t + dx * offset, z: a.z + (b.z - a.z) * t + dz * offset };
        const expected = surfaceHeight(e, t);
        if (!triangles.some((triangle) => atHeight(triangle, expected) && contains(p, triangle)))
          gaps.push({ edge: e.id, t, offset, at: p, expected });
      }
    const steps = e.traversal.kind === 'stairs' ? e.traversal.steps : 1;
    const inset = Math.min(2e-5, length / steps / 4);
    for (let step = 0; step < steps; step++) {
      const from = step / steps + inset / length,
        to = (step + 1) / steps - inset / length;
      const half = e.width / 2 - 2e-5;
      const point = (t, offset) => ({
        x: a.x + (b.x - a.x) * t + dx * offset,
        z: a.z + (b.z - a.z) * t + dz * offset,
      });
      const region = [point(from, -half), point(to, -half), point(to, half), point(from, half)];
      const required = polygonArea(region),
        height = surfaceHeight(e, (step + 0.5) / steps);
      const covered = triangles.reduce(
        (sum, triangle) => sum + (atHeight(triangle, height) ? intersectionArea(triangle, region) : 0),
        0,
      );
      if (required - covered > Math.max(1e-8, required * 1e-5))
        gaps.push({ edge: e.id, step, missingArea: required - covered, expected: height });
    }
  }
  return gaps;
}
export function terrainContactGaps(triangles, graph) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const stairs = graph.edges.filter((e) => e.traversal.kind === 'stairs');
  const gaps = [];
  for (const triangle of triangles) {
    const p = triangle.reduce((sum, v) => ({ x: sum.x + v.x / 3, z: sum.z + v.z / 3, y: sum.y + v.y / 3 }), {
      x: 0,
      z: 0,
      y: 0,
    });
    let expected = 0.045;
    for (const e of stairs) {
      const from = nodes.get(e.from)?.at,
        to = nodes.get(e.to)?.at;
      if (!from || !to) continue;
      const rising = e.traversal.toHeight > e.traversal.fromHeight,
        a = rising ? from : to,
        b = rising ? to : from;
      const dx = b.x - a.x,
        dz = b.z - a.z,
        length = Math.hypot(dx, dz),
        t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / (length * length);
      const lateral = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / length;
      if (t < -1e-6 || t > 1 + 1e-6 || lateral > e.width / 2 + 1e-6) continue;
      const low = Math.min(e.traversal.fromHeight, e.traversal.toHeight),
        high = Math.max(e.traversal.fromHeight, e.traversal.toHeight);
      const step = Math.max(1, Math.min(e.traversal.steps, Math.ceil(t * e.traversal.steps - 1e-6)));
      expected = low + ((high - low) * step) / e.traversal.steps + 0.045;
      break;
    }
    if (Math.abs(p.y - expected) > 1e-5) gaps.push({ at: p, expected });
  }
  return gaps;
}
export function inspectTriangles(triangles, blocked = []) {
  const boxes = triangles.map((t) => ({
    minX: Math.min(...t.map((p) => p.x)),
    maxX: Math.max(...t.map((p) => p.x)),
    minZ: Math.min(...t.map((p) => p.z)),
    maxZ: Math.max(...t.map((p) => p.z)),
  }));
  let overlapArea = 0,
    blockedArea = 0,
    degenerate = 0,
    outsideVertices = 0;
  for (let i = 0; i < triangles.length; i++) {
    const a = triangles[i],
      box = boxes[i];
    if (polygonArea(a) < 1e-10) degenerate++;
    for (const p of a)
      for (let side = 0; side < 6; side++) {
        const angle = ((30 + side * 60) * Math.PI) / 180;
        if (p.x * Math.cos(angle) + p.z * Math.sin(angle) > Math.sqrt(3) + 1e-6) outsideVertices++;
      }
    for (const polygon of blocked) blockedArea += intersectionArea(a, polygon);
    for (let j = i + 1; j < triangles.length; j++) {
      const other = boxes[j];
      if (
        box.maxX <= other.minX + EPSILON ||
        box.minX >= other.maxX - EPSILON ||
        box.maxZ <= other.minZ + EPSILON ||
        box.minZ >= other.maxZ - EPSILON
      )
        continue;
      overlapArea += intersectionArea(a, triangles[j]);
    }
  }
  return {
    triangles: triangles.length,
    area: triangles.reduce((sum, t) => sum + polygonArea(t), 0),
    overlapArea,
    blockedArea,
    degenerate,
    outsideVertices,
  };
}
