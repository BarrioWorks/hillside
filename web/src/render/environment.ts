import * as THREE from 'three';
import type { Region } from '../domain';
import { PALETTE } from './palette';

/**
 * Environment candidates: one rendering system driven by two tables. Each region authors its landscape in
 * OKLCH, each direction grades those colors and the light, and `resolveEnvironment` turns a pair into the
 * linear colors the ground, the shared material, and the lights consume. Architecture keeps `PALETTE`.
 */
export const ENVIRONMENT_CANDIDATES = ['cool', 'warm', 'balanced'] as const;
export type EnvironmentCandidate = (typeof ENVIRONMENT_CANDIDATES)[number];
/** Selected after the Milestone 1 review; `?environment=legacy` keeps the pre-environment palette for comparison. */
export const DEFAULT_CANDIDATE: EnvironmentCandidate = 'warm';

export const LIGHTING_PRESETS = ['afternoon', 'daylight', 'evening'] as const;
export type LightingPreset = (typeof LIGHTING_PRESETS)[number];

export interface Mood {
  sun: string;
  sunIntensity: number;
  /** Sun direction as azimuth (radians, around Y) and elevation (radians above horizon). */
  azimuth: number;
  elevation: number;
  sky: string;
  ground: string;
  ambient: number;
  exposure: number;
  /** Background gradient from zenith to horizon; fog fades distant terrain toward the horizon color. */
  zenith: string;
  horizon: string;
  windows: number;
  /** Fog share at the far edge of the board; a region scales it. */
  haze: number;
}

/** Shared light per preset. Legacy uses it as is; environments shift their regional afternoon light by its change. */
export const MOODS: Record<LightingPreset, Mood> = {
  afternoon: {
    sun: '#ffd9a8',
    sunIntensity: 3.0,
    azimuth: -2.25,
    elevation: 0.72,
    sky: '#d6e4ec',
    ground: '#c2a98a',
    ambient: 2.0,
    exposure: 1.0,
    zenith: '#a9c6cf',
    horizon: '#f2dcc0',
    windows: 0,
    haze: 0.16,
  },
  daylight: {
    sun: '#fff6ea',
    sunIntensity: 3.1,
    azimuth: -2.6,
    elevation: 1.0,
    sky: '#e1ecf5',
    ground: '#c4b8a3',
    ambient: 2.3,
    exposure: 1.0,
    zenith: '#9fc3dc',
    horizon: '#e9f0ef',
    windows: 0,
    haze: 0.1,
  },
  evening: {
    sun: '#ffa66e',
    sunIntensity: 2.6,
    azimuth: -1.95,
    elevation: 0.5,
    sky: '#a7b2d0',
    ground: '#a98472',
    ambient: 2.1,
    exposure: 1.05,
    zenith: '#58648f',
    horizon: '#f0a982',
    windows: 1.6,
    haze: 0.22,
  },
};

export const TONE_MAPPINGS = {
  neutral: THREE.NeutralToneMapping,
  agx: THREE.AgXToneMapping,
  aces: THREE.ACESFilmicToneMapping,
} as const;
export type ToneMappingName = keyof typeof TONE_MAPPINGS;

export type EnvironmentSelection =
  | { kind: 'legacy'; toneMapping: ToneMappingName }
  | { kind: 'candidate'; candidate: EnvironmentCandidate; toneMapping: ToneMappingName };

/** Perceptual color: lightness 0..1, chroma, hue in degrees. */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}
const lch = (l: number, c: number, h: number): Oklch => ({ l, c, h });

type Role = 'vegetation' | 'foliage' | 'water' | 'mineral' | 'sky' | 'light';

/** Which grade each landscape color takes. Ground is a field of meadow, lush, and dry patches; forest tiles lean toward `forestFloor`. */
const ROLES = {
  meadow: 'vegetation',
  lush: 'vegetation',
  dry: 'vegetation',
  forestFloor: 'vegetation',
  // Crowns are regraded by gain relative to `crownMid`, so foliage chroma is graded apart from grass. `foliage` is
  // the middle canopy family; the others are its neighbors on the regional canopy ramp.
  foliage: 'foliage',
  foliageDeep: 'foliage',
  foliageSage: 'foliage',
  foliageOlive: 'foliage',
  water: 'water',
  stone: 'mineral',
  soil: 'mineral',
  paving: 'mineral',
  zenith: 'sky',
  horizon: 'sky',
  sun: 'light',
  skyLight: 'light',
  groundLight: 'light',
} as const satisfies Record<string, Role>;
type LandscapeColor = keyof typeof ROLES;

interface RegionLandscape {
  colors: Record<LandscapeColor, Oklch>;
  sunIntensity: number;
  ambient: number;
  /** World units across one moisture patch; a hex is 4 units wide. */
  patchSize: number;
  /** Multiplies each preset's far-board haze: humid highlands hazier, the clear coast less. */
  haze: number;
}

export const REGION_LANDSCAPES: Record<Region, RegionLandscape> = {
  // Coffee hills: deep cultivated greens against golden, sunlit slopes.
  salento: {
    colors: {
      meadow: lch(0.68, 0.085, 128),
      lush: lch(0.58, 0.095, 141),
      dry: lch(0.76, 0.095, 104),
      forestFloor: lch(0.6, 0.05, 140),
      foliage: lch(0.55, 0.06, 146),
      foliageDeep: lch(0.47, 0.06, 152),
      foliageSage: lch(0.6, 0.045, 160),
      foliageOlive: lch(0.57, 0.075, 122),
      water: lch(0.7, 0.075, 190),
      stone: lch(0.75, 0.03, 85),
      soil: lch(0.56, 0.07, 55),
      paving: lch(0.8, 0.045, 82),
      zenith: lch(0.8, 0.04, 212),
      horizon: lch(0.91, 0.04, 88),
      sun: lch(0.92, 0.07, 80),
      skyLight: lch(0.91, 0.025, 200),
      groundLight: lch(0.74, 0.05, 105),
    },
    sunIntensity: 3.0,
    ambient: 2.0,
    patchSize: 8,
    haze: 1.1,
  },
  // Valley slopes: richer greens with warm exposed earth and a golden afternoon.
  medellin: {
    colors: {
      meadow: lch(0.67, 0.09, 122),
      lush: lch(0.57, 0.1, 135),
      dry: lch(0.72, 0.09, 92),
      forestFloor: lch(0.58, 0.06, 138),
      foliage: lch(0.54, 0.065, 140),
      foliageDeep: lch(0.46, 0.065, 148),
      foliageSage: lch(0.59, 0.048, 156),
      foliageOlive: lch(0.56, 0.08, 118),
      water: lch(0.7, 0.08, 186),
      stone: lch(0.74, 0.035, 70),
      soil: lch(0.55, 0.085, 50),
      paving: lch(0.79, 0.05, 75),
      zenith: lch(0.79, 0.045, 225),
      horizon: lch(0.89, 0.055, 70),
      sun: lch(0.9, 0.09, 68),
      skyLight: lch(0.9, 0.02, 230),
      groundLight: lch(0.72, 0.06, 72),
    },
    sunIntensity: 3.0,
    ambient: 2.0,
    patchSize: 7,
    haze: 1,
  },
  // Sabana: cool lower-chroma greens, earthy straw, a diffuse paler sun.
  bogota: {
    colors: {
      meadow: lch(0.64, 0.06, 135),
      lush: lch(0.55, 0.065, 150),
      dry: lch(0.7, 0.055, 95),
      forestFloor: lch(0.56, 0.042, 150),
      foliage: lch(0.52, 0.05, 156),
      foliageDeep: lch(0.44, 0.05, 162),
      foliageSage: lch(0.58, 0.04, 170),
      foliageOlive: lch(0.54, 0.06, 128),
      water: lch(0.66, 0.055, 210),
      stone: lch(0.7, 0.02, 90),
      soil: lch(0.5, 0.05, 55),
      paving: lch(0.76, 0.03, 85),
      zenith: lch(0.78, 0.035, 235),
      horizon: lch(0.88, 0.03, 90),
      sun: lch(0.92, 0.04, 85),
      skyLight: lch(0.88, 0.025, 235),
      groundLight: lch(0.7, 0.04, 80),
    },
    sunIntensity: 2.7,
    ambient: 2.2,
    patchSize: 9,
    haze: 1.25,
  },
  // Coast: dry straw and sand with darker wet greens, turquoise water, clear warm light.
  cartagena: {
    colors: {
      meadow: lch(0.72, 0.075, 110),
      lush: lch(0.6, 0.085, 135),
      dry: lch(0.8, 0.08, 92),
      forestFloor: lch(0.63, 0.045, 125),
      foliage: lch(0.56, 0.062, 136),
      foliageDeep: lch(0.48, 0.06, 145),
      foliageSage: lch(0.61, 0.045, 150),
      foliageOlive: lch(0.6, 0.08, 112),
      water: lch(0.72, 0.09, 195),
      stone: lch(0.78, 0.035, 80),
      soil: lch(0.6, 0.075, 60),
      paving: lch(0.83, 0.05, 80),
      zenith: lch(0.8, 0.05, 220),
      horizon: lch(0.91, 0.055, 75),
      sun: lch(0.93, 0.08, 75),
      skyLight: lch(0.91, 0.025, 215),
      groundLight: lch(0.78, 0.05, 85),
    },
    sunIntensity: 3.1,
    ambient: 2.0,
    patchSize: 7,
    haze: 0.85,
  },
};

/** A grade shifts lightness, scales chroma, and rotates hue. */
interface Grade {
  dl: number;
  chroma: number;
  dh: number;
}
interface Direction {
  grades: Record<Role, Grade>;
  sunIntensity: number;
  ambient: number;
  /** Saturation kept in foliage vertex colors before their gain; per-channel gains alone keep relative chroma. */
  foliageSaturation: number;
  /** How far the field reaches toward its lush and dry patch colors. */
  patchContrast: number;
}
const grade = (dl: number, chroma: number, dh: number): Grade => ({ dl, chroma, dh });

export const DIRECTIONS: Record<EnvironmentCandidate, Direction> = {
  cool: {
    grades: {
      vegetation: grade(0.01, 0.9, 10),
      foliage: grade(0.04, 0.75, 8),
      water: grade(0, 1, 12),
      mineral: grade(0, 0.7, 15),
      sky: grade(0.01, 0.9, 6),
      light: grade(0, 0.55, 0),
    },
    sunIntensity: 0.95,
    ambient: 1.1,
    foliageSaturation: 0.5,
    patchContrast: 0.85,
  },
  warm: {
    grades: {
      vegetation: grade(-0.005, 1.1, -10),
      foliage: grade(0, 1.1, -18),
      water: grade(0, 1.05, -10),
      mineral: grade(0, 1.25, -8),
      sky: grade(0, 1.15, -4),
      light: grade(0, 1.3, -4),
    },
    sunIntensity: 1.05,
    ambient: 0.95,
    foliageSaturation: 0.8,
    patchContrast: 1.15,
  },
  balanced: {
    grades: {
      vegetation: grade(0, 1.05, 0),
      foliage: grade(0.01, 0.9, 6),
      water: grade(0, 1, 0),
      mineral: grade(0, 1, 0),
      sky: grade(0, 1, 0),
      light: grade(0, 1, 0),
    },
    sunIntensity: 1,
    ambient: 1,
    foliageSaturation: 0.62,
    patchContrast: 1,
  },
};

/** OKLab in linear-sRGB terms (Björn Ottosson's reference matrices). */
export type Oklab = readonly [number, number, number];

export function linearToOklab(r: number, g: number, b: number): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear([L, A, B]: Oklab): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const toLab = ({ l, c, h }: Oklch): Oklab => {
  const angle = (h * Math.PI) / 180;
  return [l, c * Math.cos(angle), c * Math.sin(angle)];
};
const inGamut = (rgb: readonly number[]) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** Gamut-maps by lowering chroma at constant lightness and hue, so a grade never clips into a new hue. */
function oklchToLinear(color: Oklch): THREE.Color {
  let rgb = oklabToLinear(toLab(color));
  if (!inGamut(rgb)) {
    let low = 0,
      high = color.c;
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      if (inGamut(oklabToLinear(toLab({ ...color, c: mid })))) low = mid;
      else high = mid;
    }
    rgb = oklabToLinear(toLab({ ...color, c: low }));
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return new THREE.Color().setRGB(clamp(rgb[0]), clamp(rgb[1]), clamp(rgb[2]), THREE.LinearSRGBColorSpace);
}

const applyGrade = (color: Oklch, { dl, chroma, dh }: Grade): Oklch => ({
  l: Math.min(0.98, Math.max(0.05, color.l + dl)),
  c: Math.max(0, color.c * chroma),
  h: (((color.h + dh) % 360) + 360) % 360,
});

/** Rec. 709 luminance weights for linear RGB; the material desaturates foliage with the same weights. */
export const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** Mixes a linear color toward its luminance, keeping `saturation` of its chroma. */
export function desaturate(color: THREE.Color, saturation: number): THREE.Color {
  const luma = color.r * LUMA[0] + color.g * LUMA[1] + color.b * LUMA[2];
  return new THREE.Color().setRGB(
    luma + (color.r - luma) * saturation,
    luma + (color.g - luma) * saturation,
    luma + (color.b - luma) * saturation,
  );
}

/** Per-channel ratio that moves a legacy vertex color onto its environment target, in linear RGB. */
function gain(target: THREE.Color, legacy: string | THREE.Color, saturation = 1): THREE.Color {
  const from = desaturate(typeof legacy === 'string' ? new THREE.Color(legacy) : legacy, saturation);
  return new THREE.Color().setRGB(target.r / from.r, target.g / from.g, target.b / from.b);
}

const fromLab = ([l, a, b]: Oklab): Oklch => ({
  l,
  c: Math.hypot(a, b),
  h: ((((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360,
});
const hexLab = (hex: string): Oklab => {
  const color = new THREE.Color(hex);
  return linearToOklab(color.r, color.g, color.b);
};

/** Canopy families in ramp order, so neighbors on the field are related: cool sage, deep, middle, warm olive. */
export const CANOPY_FAMILIES = ['sage', 'deep', 'middle', 'olive'] as const;
/** Share of green crowns in each family; the remaining twentieth of crowns are authored accents such as blooms. */
export const CANOPY_SHARES = { sage: 15, deep: 25, middle: 45, olive: 10 } as const;
type CanopyGains = readonly [THREE.Color, THREE.Color, THREE.Color, THREE.Color];

/** Water families as grades of the region's water: a matte body, deeper pools, pale highlights, and white edges. */
const WATER_FAMILY = {
  deep: grade(-0.07, 1.15, 8),
  highlight: grade(0.08, 0.6, -6),
  edge: grade(0.12, 0.45, -8),
} as const;

export interface ResolvedLight {
  readonly sun: THREE.Color;
  readonly sunIntensity: number;
  readonly skyLight: THREE.Color;
  readonly groundLight: THREE.Color;
  readonly ambient: number;
  readonly exposure: number;
  /** sRGB CSS colors for the background gradient and fog. */
  readonly zenith: string;
  readonly horizon: string;
  /** Fog share at the far edge of the board. */
  readonly haze: number;
}

export interface ResolvedEnvironment {
  readonly candidate: EnvironmentCandidate;
  readonly region: Region;
  readonly ground: {
    readonly meadow: Oklab;
    readonly lush: Oklab;
    readonly dry: Oklab;
    readonly forestFloor: Oklab;
    readonly patchSize: number;
    readonly patchContrast: number;
  };
  /** Multipliers the shared material applies to vertex colors already baked into cached tile geometry. */
  readonly foliageSaturation: number;
  readonly gains: {
    readonly foliage: THREE.Color;
    readonly stone: THREE.Color;
    readonly soil: THREE.Color;
    readonly paving: THREE.Color;
  };
  /** Per-family multipliers on graded crowns, in `CANOPY_FAMILIES` order; the middle family is identity. */
  readonly canopy: CanopyGains;
  /** Linear water colors; the material replaces the flat legacy water with them. */
  readonly water: {
    readonly body: THREE.Color;
    readonly deep: THREE.Color;
    readonly highlight: THREE.Color;
    readonly edge: THREE.Color;
  };
  readonly light: Readonly<Record<LightingPreset, ResolvedLight>>;
}

export function resolveEnvironment(candidate: EnvironmentCandidate, region: Region): ResolvedEnvironment {
  const landscape = REGION_LANDSCAPES[region];
  const direction = DIRECTIONS[candidate];
  const graded = (name: LandscapeColor) => applyGrade(landscape.colors[name], direction.grades[ROLES[name]]);
  const linear = (name: LandscapeColor) => oklchToLinear(graded(name));
  const lab = (name: LandscapeColor): Oklab => {
    const color = linear(name);
    return linearToOklab(color.r, color.g, color.b);
  };
  const foliage = linear('foliage');
  const relative = (name: LandscapeColor) => gain(linear(name), foliage);
  const water = graded('water');
  const lit = (preset: LightingPreset): ResolvedLight => {
    const mood = MOODS[preset];
    // Each preset grades the region's afternoon light the way it grades the shared light: the same lightness
    // step, chroma ratio, and hue turn. Regions keep their identity, and a warm regional sun stays warm at noon.
    // Afternoon is the region's own authored light.
    const shift = (name: LandscapeColor, key: 'sun' | 'sky' | 'ground' | 'zenith' | 'horizon') => {
      const to = fromLab(hexLab(mood[key]));
      const from = fromLab(hexLab(MOODS.afternoon[key]));
      const turn = ((to.h - from.h + 540) % 360) - 180;
      const ratio = Math.min(3, Math.max(0.25, to.c / Math.max(from.c, 1e-3)));
      const color = applyGrade(graded(name), grade(to.l - from.l, ratio, turn));
      return oklchToLinear({ ...color, l: Math.min(0.97, color.l) });
    };
    return {
      sun: shift('sun', 'sun'),
      sunIntensity:
        landscape.sunIntensity * direction.sunIntensity * (mood.sunIntensity / MOODS.afternoon.sunIntensity),
      skyLight: shift('skyLight', 'sky'),
      groundLight: shift('groundLight', 'ground'),
      ambient: landscape.ambient * direction.ambient * (mood.ambient / MOODS.afternoon.ambient),
      exposure: mood.exposure,
      zenith: `#${shift('zenith', 'zenith').getHexString()}`,
      horizon: `#${shift('horizon', 'horizon').getHexString()}`,
      haze: mood.haze * landscape.haze,
    };
  };
  return {
    candidate,
    region,
    ground: {
      meadow: lab('meadow'),
      lush: lab('lush'),
      dry: lab('dry'),
      forestFloor: lab('forestFloor'),
      patchSize: landscape.patchSize,
      patchContrast: direction.patchContrast,
    },
    foliageSaturation: direction.foliageSaturation,
    gains: {
      foliage: gain(foliage, PALETTE.crownMid, direction.foliageSaturation),
      stone: gain(linear('stone'), PALETTE.retaining),
      soil: gain(linear('soil'), PALETTE.skirtMid),
      paving: gain(linear('paving'), PALETTE.walkway),
    },
    canopy: [
      relative('foliageSage'),
      relative('foliageDeep'),
      new THREE.Color(1, 1, 1),
      relative('foliageOlive'),
    ],
    water: {
      body: oklchToLinear(water),
      deep: oklchToLinear(applyGrade(water, WATER_FAMILY.deep)),
      highlight: oklchToLinear(applyGrade(water, WATER_FAMILY.highlight)),
      edge: oklchToLinear(applyGrade(water, WATER_FAMILY.edge)),
    },
    light: {
      afternoon: lit('afternoon'),
      daylight: lit('daylight'),
      evening: lit('evening'),
    },
  };
}

function hash(x: number, z: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1) on a unit lattice. The material's `bbValue` is the same function in GLSL. */
function valueNoise(x: number, z: number, salt: number): number {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const fx = x - ix,
    fz = z - iz;
  const u = fx * fx * (3 - 2 * fx),
    v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, salt),
    b = hash(ix + 1, iz, salt),
    c = hash(ix, iz + 1, salt),
    d = hash(ix + 1, iz + 1, salt);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
const mixLab = (a: Oklab, b: Oklab, t: number): Oklab => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Salt namespace for visual-only randomness; bump the version to reshuffle patches without touching gameplay. */
const FIELD_VERSION = 1;

/** Where a world seed puts the field: a hash salt and a lattice offset, shared by the ground mesh and the shader. */
export interface FieldFrame {
  readonly salt: number;
  readonly offsetX: number;
  readonly offsetZ: number;
}
export function fieldFrame(seed: number): FieldFrame {
  return {
    salt: Math.imul(seed | 0, 0x2545f491) ^ FIELD_VERSION,
    offsetX: hash(seed | 0, 1, FIELD_VERSION) * 512,
    offsetZ: hash(seed | 0, 2, FIELD_VERSION) * 512,
  };
}

/** Canopy patches are a little smaller than ground patches, about one and a half hexes across. */
export const CANOPY_SCALE = 0.8;
/** Noise width over which one canopy family hands over to the next, so no crown splits along a hard line. */
export const CANOPY_BLEND = 0.05;
const canopyNoise = (px: number, pz: number, salt: number) =>
  valueNoise(px, pz, salt + 3) * 0.8 + valueNoise(px * 2.1, pz * 2.1, salt + 4) * 0.2;

/**
 * Noise values splitting `canopyNoise` into the family shares. Value noise bunches around its middle, so the
 * breaks come from its sampled distribution rather than from the shares directly.
 */
export const CANOPY_BREAKS: readonly [number, number, number] = (() => {
  const samples: number[] = [];
  for (let i = 0; i < 160; i++)
    for (let j = 0; j < 160; j++) samples.push(canopyNoise(i * 0.37, j * 0.41, 0x5eed));
  samples.sort((a, b) => a - b);
  const total = CANOPY_FAMILIES.reduce((sum, family) => sum + CANOPY_SHARES[family], 0);
  let cumulative = 0;
  const breaks = CANOPY_FAMILIES.slice(0, 3).map((family) => {
    cumulative += CANOPY_SHARES[family] / total;
    return samples[Math.floor(cumulative * (samples.length - 1))] as number;
  });
  return [breaks[0] as number, breaks[1] as number, breaks[2] as number];
})();

const FOREST_STRENGTH = 0.78;
/** Forest floor is full within this distance of a forest tile's center; a hex's inradius is about 1.73. */
const FOREST_CORE = 1.1;
/** And gone by this distance, a little past the shared edge, so neighboring forests merge into one mass. */
const FOREST_REACH = 3.0;
/** Low-frequency wobble on that distance, in world units, so the mass never traces the hex outline. */
const FOREST_WARP = 0.8;

/**
 * Ground color as a pure function of world XZ, the world seed, and how much forest owns the point. Every tile
 * sampling a shared position gets the same color, so patches flow across tile boundaries.
 */
export class GroundField {
  private readonly frame: FieldFrame;

  constructor(
    readonly environment: ResolvedEnvironment,
    seed: number,
  ) {
    this.frame = fieldFrame(seed);
  }

  /** Field lattice coordinates; a rotated frame keeps patch edges from lining up with the hex lattice. */
  private lattice(x: number, z: number, scale: number): [number, number] {
    const size = this.environment.ground.patchSize * scale;
    return [
      (x * 0.866 - z * 0.5) / size + this.frame.offsetX,
      (x * 0.5 + z * 0.866) / size + this.frame.offsetZ,
    ];
  }

  /** Moisture and sunlit weights in [0, 1] at a world point. */
  weights(x: number, z: number): { lush: number; dry: number } {
    const { patchContrast } = this.environment.ground;
    const { salt } = this.frame;
    const [px, pz] = this.lattice(x, z, 1);
    const moisture = valueNoise(px, pz, salt) * 0.75 + valueNoise(px * 2.1, pz * 2.1, salt + 1) * 0.25;
    const sun = valueNoise(px * 1.3 + 7.3, pz * 1.3 - 3.1, salt + 2);
    return {
      lush: smoothstep(0.32, 0.85, moisture) * patchContrast,
      dry: smoothstep(0.4, 0.9, sun) * (1 - smoothstep(0.35, 0.75, moisture)) * patchContrast,
    };
  }

  /**
   * Share of forest floor at a world point, from the centers of forest tiles: a soft disc around each, merged
   * where they meet and warped by the field. Pure in position, so shared ground vertices still agree.
   */
  forestCover(x: number, z: number, forests: readonly { x: number; z: number }[]): number {
    if (!forests.length) return 0;
    const [px, pz] = this.lattice(x, z, 0.45);
    const warp = (valueNoise(pz, px, this.frame.salt + 5) - 0.5) * 2 * FOREST_WARP;
    let open = 1;
    for (const forest of forests) {
      const distance = Math.hypot(x - forest.x, z - forest.z) + warp;
      if (distance < FOREST_REACH) open *= 1 - smoothstep(FOREST_REACH, FOREST_CORE, distance);
    }
    return 1 - open;
  }

  /** Linear RGB at a world point; `forest` is the forest-floor share, 0..1. */
  color(x: number, z: number, forest: number, target = new THREE.Color()): THREE.Color {
    const { meadow, lush, dry, forestFloor } = this.environment.ground;
    const w = this.weights(x, z);
    let lab = mixLab(meadow, lush, Math.min(1, w.lush));
    lab = mixLab(lab, dry, Math.min(1, w.dry));
    lab = mixLab(lab, forestFloor, forest * FOREST_STRENGTH);
    const [r, g, b] = oklabToLinear(lab);
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return target.setRGB(clamp(r), clamp(g), clamp(b), THREE.LinearSRGBColorSpace);
  }

  /** Weights of each canopy family at a world point, in `CANOPY_FAMILIES` order; they sum to 1. */
  canopy(x: number, z: number): [number, number, number, number] {
    const [px, pz] = this.lattice(x, z, CANOPY_SCALE);
    const n = canopyNoise(pz, px, this.frame.salt);
    let weights: [number, number, number, number] = [1, 0, 0, 0];
    CANOPY_BREAKS.forEach((at, i) => {
      const t = smoothstep(at - CANOPY_BLEND, at + CANOPY_BLEND, n);
      weights = weights.map((w, k) => w * (1 - t) + (k === i + 1 ? t : 0)) as typeof weights;
    });
    return weights;
  }
}

const isCandidate = (value: string | null): value is EnvironmentCandidate =>
  ENVIRONMENT_CANDIDATES.some((candidate) => candidate === value);
const isToneMapping = (value: string | null): value is ToneMappingName =>
  value !== null && Object.hasOwn(TONE_MAPPINGS, value);

/**
 * Warm Painterly is the production environment. `?environment=cool|warm|balanced` picks a candidate for comparison,
 * `?environment=legacy` restores the pre-environment palette, and anything else falls back to Warm Painterly.
 * `?toneMapping=` overrides the tone mapper for either, defaulting to Neutral.
 */
export function parseEnvironmentQuery(search: string): EnvironmentSelection {
  const params = new URLSearchParams(search);
  const environment = params.get('environment');
  const tone = params.get('toneMapping');
  const toneMapping = isToneMapping(tone) ? tone : 'neutral';
  if (environment === 'legacy') return { kind: 'legacy', toneMapping };
  return {
    kind: 'candidate',
    candidate: isCandidate(environment) ? environment : DEFAULT_CANDIDATE,
    toneMapping,
  };
}

export function environmentFor(selection: EnvironmentSelection, region: Region): ResolvedEnvironment | null {
  return selection.kind === 'candidate' ? resolveEnvironment(selection.candidate, region) : null;
}
