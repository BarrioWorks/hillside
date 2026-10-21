import * as THREE from 'three';

/** Medellín hillside palette (sRGB). Plaster colors are muted so neighbors harmonize at any pairing. */
export const PALETTE = {
  terracotta: '#b5603f',
  burntOrange: '#c9733a',
  coral: '#e0806e',
  brickRed: '#9e4a35',
  ochre: '#c99a52',
  mustard: '#d9ae3f',
  cream: '#eadfc4',
  offWhite: '#f1ede3',
  turquoise: '#4fb3bf',
  teal: '#5f8f88',
  dustyBlue: '#6f8fb5',
  mutedGreen: '#7e9a5a',
  concrete: '#a9a398',
  brick: '#b8613f',
  brickDark: '#94492f',
  mortar: '#cfc6b4',
  windowDark: '#2b3236',
  metal: '#4a5157',
  tankBlack: '#24282b',
  wood: '#8a5e3b',
  leaf: '#5f8c4a',
  leafDeep: '#3f6b3c',
  grass: '#96b47f',
  soil: '#a8643f',
  stone: '#b9ad99',
  asphalt: '#8e8a84',
  tankBlue: '#2f5f8f',
  zinc: '#9aa3a1',
  shutter: '#8b958f',
  lamp: '#ffe2a8',
  // Hex landscape, candidate A "Sage valley" from docs/strategy-redesign.md.
  meadow: '#94a679',
  meadowLight: '#adbb8c',
  meadowLow: '#7d9168',
  lawn: '#a2b47f',
  forestFloor: '#8a9c72',
  skirtTop: '#b8946c',
  skirtMid: '#977656',
  skirtDeep: '#6d5848',
  retaining: '#bdb3a1',
  coping: '#d3cbbb',
  walkway: '#cdbd9d',
  water: '#6fb7b4',
  waterDeep: '#4e9ea5',
  foam: '#eaf2ea',
  crownLight: '#71895a',
  crownMid: '#587250',
  crownDeep: '#3f5a45',
  bank: '#7f8a63',
  contact: '#7a8a5c',
  bloom: '#c4457a',
} as const;
export type PaletteName = keyof typeof PALETTE;

export const PLASTER: readonly PaletteName[] = [
  'terracotta',
  'turquoise',
  'mustard',
  'coral',
  'dustyBlue',
  'ochre',
  'teal',
  'cream',
  'burntOrange',
  'mutedGreen',
  'coral',
  'offWhite',
  'turquoise',
];
export const TRIM: readonly PaletteName[] = [
  'teal',
  'brickRed',
  'dustyBlue',
  'mustard',
  'turquoise',
  'coral',
];

export function color(name: PaletteName): THREE.Color {
  return new THREE.Color(PALETTE[name]);
}

/** Surface ids are written to a vertex attribute; the shared material derives pattern and roughness from them. */
export const Surface = {
  plaster: 0,
  brick: 1,
  concrete: 2,
  tile: 3,
  metal: 4,
  wood: 5,
  glass: 6,
  foliage: 7,
  grass: 8,
  soil: 9,
  stone: 10,
  paint: 11,
  mural: 12,
  fabric: 13,
  corrugated: 14,
  paving: 15,
  water: 16,
} as const;
export type SurfaceId = (typeof Surface)[keyof typeof Surface];
