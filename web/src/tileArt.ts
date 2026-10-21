import type { Edge, Family, Kind } from './domain';

/** Short names and one-line descriptions for each tile kind, shown with the tile in hand. */
export const KIND_INFO: Record<Kind, { name: string; description: string }> = {
  casas: { name: 'Casas', description: 'Homes along a path. Homes count once a path reaches their door.' },
  tienda: { name: 'Tienda', description: 'A corner shop with homes beside it.' },
  plaza: { name: 'Plaza', description: 'A small square where several paths meet.' },
  parque: { name: 'Parque', description: 'A planted park crossed by a path.' },
  capilla: { name: 'Capilla', description: 'A small chapel on its own plaza.' },
  monte: { name: 'Monte', description: 'Hillside woodland. Nature joins nature.' },
  sendero: { name: 'Sendero', description: 'A footpath between gardens.' },
  quebrada: { name: 'Quebrada', description: 'A mountain stream. Water must meet water.' },
  inicio: { name: 'Settlement', description: 'Where this neighborhood began.' },
};

export const FAMILY_NAME: Record<Family, string> = {
  residential: 'Residential',
  nature: 'Nature',
  landscape: 'Landscape',
  water: 'Water',
  community: 'Community',
  landmark: 'Landmark',
};

const FILL: Record<Edge, string> = {
  nature: '#94a679',
  path: '#a9b88a',
  homes: '#c9a58a',
  water: '#94a679',
};
const PATH = '#ece0c4';
const WATER = '#4f9ea6';

/**
 * A flat-top hex drawn as six edge sectors, oriented like the default camera view (+X right, +Z down).
 * Per-side arrays are in world directions, so pass rotated edges and path groups. Paths are drawn per
 * group, so two separate walks on one tile look separate.
 */
export function tileSvg(kind: Kind, edges: readonly Edge[], paths: readonly number[], size: number): string {
  const r = 46;
  const at = (angle: number, radius: number) => [
    Math.cos((angle * Math.PI) / 180) * radius,
    Math.sin((angle * Math.PI) / 180) * radius,
  ];
  const point = (angle: number, radius: number) =>
    at(angle, radius)
      .map((value) => value.toFixed(2))
      .join(' ');
  const parts: string[] = [];
  edges.forEach((edge, side) => {
    const a = side * 60,
      b = a + 60;
    const fill = edge === 'nature' && kind === 'monte' ? '#7f9468' : FILL[edge];
    parts.push(`<path d="M0 0L${point(a, r)}L${point(b, r)}Z" fill="${fill}"/>`);
  });
  edges.forEach((edge, side) => {
    const mid = side * 60 + 30;
    if (edge === 'homes') {
      const [x, y] = at(mid, 30) as [number, number];
      parts.push(
        `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${mid + 90})"><rect x="-7" y="-5" width="14" height="10" rx="1.5" fill="#e9e1d1"/><path d="M-8 -5L0 -11L8 -5Z" fill="#b5603f"/></g>`,
      );
    } else if (edge === 'nature') {
      const [x, y] = at(mid + 8, 31) as [number, number];
      parts.push(
        `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${kind === 'monte' ? 7.5 : 5.5}" fill="${kind === 'monte' ? '#3f5a45' : '#587250'}"/>`,
      );
    }
  });
  const water = edges.flatMap((edge, side) => (edge === 'water' ? [side] : []));
  const stroke = (d: string, color: string, width: number) =>
    parts.push(
      `<path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round"/>`,
    );
  const curve = (sides: number[], color: string) => {
    const ends = sides.map((side) => point(side * 60 + 30, r * 0.87));
    if (sides.length === 1) stroke(`M${ends[0]}L${point((sides[0] ?? 0) * 60 + 30, 14)}`, color, 10);
    else if (sides.length === 2) stroke(`M${ends[0]}Q0 0 ${ends[1]}`, color, 10);
    else for (const end of ends) stroke(`M${end}L0 0`, color, 10);
  };
  if (water.length) curve(water, WATER);
  const groups = new Map<number, number[]>();
  paths.forEach((group, side) => {
    if (group) groups.set(group, [...(groups.get(group) ?? []), side]);
  });
  for (const sides of groups.values()) curve(sides, PATH);
  if (kind === 'plaza' || kind === 'capilla')
    parts.push(
      `<path d="M${[0, 1, 2, 3, 4, 5].map((i) => point(i * 60, 15)).join('L')}Z" fill="${PATH}" stroke="#d3cbbb" stroke-width="2"/>`,
    );
  if (kind === 'capilla') parts.push(`<path d="M-1.5 -12h3v6h5v3h-5v9h-3v-9h-5v-3h5Z" fill="#7b5a3a"/>`);
  if (kind === 'tienda') parts.push(`<rect x="-6" y="-4" width="12" height="8" rx="2" fill="#F05D50"/>`);
  const outline = `<path d="M${[0, 1, 2, 3, 4, 5].map((i) => point(i * 60, r)).join('L')}Z" fill="none" stroke="#fffaf2" stroke-width="3" stroke-linejoin="round"/>`;
  return `<svg class="tile-art" width="${size}" height="${size}" viewBox="-50 -50 100 100" aria-hidden="true">${parts.join('')}${outline}</svg>`;
}
