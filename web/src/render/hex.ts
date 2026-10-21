import type { HexPoint } from '../domain';

/**
 * World layout of the flat-top hex lattice. Mirrors `crates/barrio-core/src/hex.rs`: edge `i` faces the
 * neighbor `DIRECTIONS[i]` along the angle `30° + 60° i`, measured from +X toward +Z.
 */
export const HEX = 2;
export const INRADIUS = (HEX * Math.sqrt(3)) / 2;
/** Height of one terrace level. */
export const LEVEL = 0.6;
/** Depth of exposed sides below the lowest tile; every edge of the island reaches the same base. */
export const SKIRT = 0.9;

export const DIRECTIONS: readonly HexPoint[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export const key = (q: number, r: number): string => `${q},${r}`;

export function neighbor(hex: HexPoint, side: number): HexPoint {
  const d = DIRECTIONS[((side % 6) + 6) % 6] as HexPoint;
  return { q: hex.q + d.q, r: hex.r + d.r };
}

export function center(q: number, r: number): { x: number; z: number } {
  return { x: 1.5 * HEX * q, z: Math.sqrt(3) * HEX * (r + q / 2) };
}

/** Outward normal angle of edge `side`. */
export function edgeAngle(side: number): number {
  return ((30 + 60 * side) * Math.PI) / 180;
}

/** Corner `i` sits between edges `i - 1` and `i`. */
export function corner(i: number, radius = HEX): { x: number; z: number } {
  const angle = (60 * i * Math.PI) / 180;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/** The hex containing a world point, by cube rounding. */
export function hexAt(x: number, z: number): HexPoint {
  const q = (2 / 3) * (x / HEX);
  const r = (-1 / 3) * (x / HEX) + (Math.sqrt(3) / 3) * (z / HEX);
  const s = -q - r;
  let rq = Math.round(q),
    rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q),
    dr = Math.abs(rr - r),
    ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 };
}

/** Rotation about +Y that turns a model's front (+Z) to face along `angle` in the XZ plane. */
export function facing(angle: number): number {
  return Math.atan2(Math.cos(angle), Math.sin(angle));
}
