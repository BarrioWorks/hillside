import * as THREE from 'three';
import {
  CANOPY_BLEND,
  CANOPY_BREAKS,
  CANOPY_SCALE,
  fieldFrame,
  LUMA,
  type ResolvedEnvironment,
} from './environment';
import { PALETTE } from './palette';

/**
 * One shared material for every opaque surface in the world. Geometry carries a `surface` attribute and
 * vertex colors; the shader adds world-space procedural detail (brick coursing, stone, paving, murals) so a
 * single draw call per geometry batch still reads as distinct materials. Patterns fade out as they approach
 * pixel size (fwidth), which keeps the orthographic view free of moiré at every zoom level.
 */
export const glow = { value: 0 };
const white = () => new THREE.Color(1, 1, 1);
const luma = (hex: string) => {
  const color = new THREE.Color(hex);
  return color.r * LUMA[0] + color.g * LUMA[1] + color.b * LUMA[2];
};
/** Environment uniforms shared by every compiled program; only read when BARRIO_ENVIRONMENT is defined. */
const environmentUniforms = {
  uEnvFoliage: { value: white() },
  uEnvFoliageSaturation: { value: 1 },
  uEnvStone: { value: white() },
  uEnvSoil: { value: white() },
  uEnvPaving: { value: white() },
  uCanopy: { value: [white(), white(), white(), white()] },
  uCanopyBreaks: { value: new THREE.Vector3(...CANOPY_BREAKS) },
  /** Field lattice offset (xy), patch size (z), and patch contrast (w); see `GroundField`. */
  uField: { value: new THREE.Vector4(0, 0, 8, 1) },
  uFieldSalt: { value: 0 },
  uGroundMeadow: { value: new THREE.Vector3() },
  uGroundLush: { value: new THREE.Vector3() },
  uGroundDry: { value: new THREE.Vector3() },
  uGroundLuma: { value: luma(PALETTE.meadow) },
  uWaterBody: { value: white() },
  uWaterDeep: { value: white() },
  uWaterHighlight: { value: white() },
  uWaterEdge: { value: white() },
  uWaterLuma: { value: luma(PALETTE.water) },
  uWaterDeepLuma: { value: luma(PALETTE.waterDeep) },
};
const muralColors = ['coral', 'mustard', 'turquoise', 'dustyBlue', 'mutedGreen', 'offWhite'] as const;

/**
 * The seeded world-space field in GLSL. `bbValue` matches `valueNoise` in environment.ts, integer hash included,
 * so green soil and crowns sample the same patches the ground mesh bakes on the CPU.
 */
const fieldGlsl = /* glsl */ `
uniform vec4 uField;
uniform int uFieldSalt;
uniform vec3 uGroundMeadow;
uniform vec3 uGroundLush;
uniform vec3 uGroundDry;
uniform vec3 uCanopy[4];
uniform vec3 uCanopyBreaks;
varying vec3 vEnvTint;
float bbLattice(ivec2 i, uint salt) {
  uint h = (uint(i.x) * 0x27d4eb2du) ^ (uint(i.y) * 0x165667b1u) ^ (salt * 0x9e3779b9u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h ^= h >> 13u;
  h *= 0xc2b2ae35u;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}
float bbValue(vec2 p, uint salt) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = bbLattice(c, salt), b = bbLattice(c + ivec2(1, 0), salt);
  float d = bbLattice(c + ivec2(0, 1), salt), e = bbLattice(c + ivec2(1, 1), salt);
  return a + (b - a) * u.x + (d - a) * u.y + (a - b - d + e) * u.x * u.y;
}
vec2 bbLatticePoint(vec2 xz, float scale) {
  return vec2(xz.x * 0.866 - xz.y * 0.5, xz.x * 0.5 + xz.y * 0.866) / (uField.z * scale) + uField.xy;
}
vec3 bbOklabToLinear(vec3 lab) {
  vec3 lms = vec3(
    lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
    lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
    lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z);
  lms = lms * lms * lms;
  return vec3(
    4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
    -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
    -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.707614701 * lms.z);
}
vec3 bbGround(vec2 xz) {
  vec2 p = bbLatticePoint(xz, 1.0);
  uint salt = uint(uFieldSalt);
  float moisture = bbValue(p, salt) * 0.75 + bbValue(p * 2.1, salt + 1u) * 0.25;
  float sun = bbValue(p * 1.3 + vec2(7.3, -3.1), salt + 2u);
  float lush = smoothstep(0.32, 0.85, moisture) * uField.w;
  float dry = smoothstep(0.4, 0.9, sun) * (1.0 - smoothstep(0.35, 0.75, moisture)) * uField.w;
  vec3 lab = mix(uGroundMeadow, uGroundLush, min(1.0, lush));
  lab = mix(lab, uGroundDry, min(1.0, dry));
  return clamp(bbOklabToLinear(lab), 0.0, 1.0);
}
vec3 bbCanopy(vec2 xz) {
  vec2 p = bbLatticePoint(xz, ${CANOPY_SCALE.toFixed(4)}).yx;
  uint salt = uint(uFieldSalt);
  float n = bbValue(p, salt + 3u) * 0.8 + bbValue(p * 2.1, salt + 4u) * 0.2;
  const float blend = ${CANOPY_BLEND.toFixed(4)};
  vec3 tint = mix(uCanopy[0], uCanopy[1], smoothstep(uCanopyBreaks.x - blend, uCanopyBreaks.x + blend, n));
  tint = mix(tint, uCanopy[2], smoothstep(uCanopyBreaks.y - blend, uCanopyBreaks.y + blend, n));
  return mix(tint, uCanopy[3], smoothstep(uCanopyBreaks.z - blend, uCanopyBreaks.z + blend, n));
}
`;
const vertexHeader = /* glsl */ `
attribute float surface;
varying float vSurface;
varying vec3 vPatternPosition;
varying vec3 vPatternNormal;
#ifdef BARRIO_ENVIRONMENT
${fieldGlsl}
#endif
`;
const vertexBody = /* glsl */ `
vSurface = surface;
vec4 patternWorld = vec4(transformed, 1.0);
vec3 patternNormal = objectNormal;
#ifdef USE_INSTANCING
patternWorld = instanceMatrix * patternWorld;
patternNormal = mat3(instanceMatrix) * patternNormal;
#endif
patternWorld = modelMatrix * patternWorld;
vPatternPosition = patternWorld.xyz;
vPatternNormal = normalize(mat3(modelMatrix) * patternNormal);
#ifdef BARRIO_ENVIRONMENT
// Per vertex: crowns and banks are small beside their patches, so the field barely changes across one.
vEnvTint = vec3(1.0);
{
  int s = int(surface + 0.5);
  vec3 c = vColor.rgb;
  if (c.g > c.r && c.g > c.b) {
    if (s == 7) vEnvTint = bbCanopy(patternWorld.xz);
    else if (s == 9) vEnvTint = bbGround(patternWorld.xz);
  }
}
#endif
`;
const fragmentHeader = /* glsl */ `
varying float vSurface;
varying vec3 vPatternPosition;
varying vec3 vPatternNormal;
uniform float uGlow;
uniform vec3 uMural[6];
#ifdef BARRIO_ENVIRONMENT
uniform vec3 uEnvFoliage;
uniform float uEnvFoliageSaturation;
uniform vec3 uEnvStone;
uniform vec3 uEnvSoil;
uniform vec3 uEnvPaving;
uniform vec4 uField;
uniform float uGroundLuma;
uniform vec3 uWaterBody;
uniform vec3 uWaterDeep;
uniform vec3 uWaterHighlight;
uniform vec3 uWaterEdge;
uniform float uWaterLuma;
uniform float uWaterDeepLuma;
varying vec3 vEnvTint;
#endif
// Arithmetic hashes (Dave Hoskins, "Hash without Sine"): no transcendental calls per pixel.
float bbHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float bbHash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float bbNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bbHash(i), bbHash(i + vec2(1, 0)), f.x), mix(bbHash(i + vec2(0, 1)), bbHash(i + vec2(1, 1)), f.x), f.y);
}
// Running-bond masonry. Returns (mortar coverage, per-unit random, visibility).
vec3 bbBond(vec2 uv, vec2 size, float mortar, float jitter) {
  float row = floor(uv.y / size.y);
  float u = uv.x / size.x + mod(row, 2.0) * 0.5 + bbHash(vec2(row, 3.1)) * jitter;
  vec2 f = vec2(fract(u), fract(uv.y / size.y));
  vec2 w = vec2(fwidth(u), fwidth(uv.y / size.y));
  float mx = 1.0 - smoothstep(mortar * 0.55 - w.x, mortar * 0.55 + w.x, min(f.x, 1.0 - f.x));
  float my = 1.0 - smoothstep(mortar - w.y, mortar + w.y, min(f.y, 1.0 - f.y));
  float visible = 1.0 - smoothstep(0.18, 0.42, max(w.x, w.y));
  return vec3(max(mx, my), bbHash(vec2(floor(u), row)), visible);
}
vec2 bbWallUV() {
  vec3 n = abs(vPatternNormal);
  return vec2(n.x > n.z ? vPatternPosition.z : vPatternPosition.x, vPatternPosition.y);
}
`;
/**
 * Regrades environmental vertex colors baked into cached geometry. Green-dominant colors are plants: green
 * crowns take their canopy family and keep their authored light-to-deep tones, blooms stay as authored, and green
 * soil (stream banks, house contact patches) takes the ground field, a little darker as the legacy color was.
 * Water takes its family: vertex luminance between the legacy `waterDeep` and `water` picks margin or center, and
 * stable world-space patches add pools and highlights to the center. Falls take the pale edge family.
 */
const environmentBody = /* glsl */ `
{
  int s = int(vSurface + 0.5);
  vec3 c = diffuseColor.rgb;
  float luma = dot(c, vec3(${LUMA.join(', ')}));
  bool green = c.g > c.r && c.g > c.b;
  if (s == 7 && green)
    diffuseColor.rgb = mix(vec3(luma), c, uEnvFoliageSaturation) * uEnvFoliage * vEnvTint;
  else if (s == 9) diffuseColor.rgb = green ? vEnvTint * mix(1.0, luma / uGroundLuma, 0.6) : c * uEnvSoil;
  else if (s == 16) {
    // Vertex luminance places the fragment between the authored waterDeep margin and the water center.
    float body = smoothstep(uWaterDeepLuma, uWaterLuma, luma);
    vec2 at = vPatternPosition.xz + uField.xy;
    float up = clamp(vPatternNormal.y, 0.0, 1.0);
    vec3 water = mix(uWaterDeep, uWaterBody, body);
    water = mix(water, uWaterDeep, smoothstep(0.35, 0.85, bbNoise(at * 0.3)) * 0.5 * body);
    water = mix(water, uWaterHighlight, smoothstep(0.6, 0.85, bbNoise(at * 0.8 + 17.0)) * 0.45 * up * body);
    diffuseColor.rgb = mix(water, uWaterEdge, (1.0 - up) * 0.65);
  }
  else if (s == 10) diffuseColor.rgb *= uEnvStone;
  else if (s == 15) diffuseColor.rgb *= uEnvPaving;
}
`;
const fragmentBody = /* glsl */ `
int bbSurface = int(vSurface + 0.5);
vec3 bbN = abs(vPatternNormal);
bool bbWall = bbN.y < 0.6;
vec3 bbBase = diffuseColor.rgb;
if (bbSurface == 1 && bbWall) {
  vec3 b = bbBond(bbWallUV(), vec2(0.24, 0.1), 0.12, 0.0);
  vec3 brick = bbBase * (0.84 + 0.3 * b.y);
  vec3 mortar = mix(bbBase, vec3(${new THREE.Color(PALETTE.mortar).toArray().join(',')}), 0.7);
  diffuseColor.rgb = mix(bbBase, mix(brick, mortar, b.x), b.z);
} else if (bbSurface == 10 && bbWall) {
  vec3 b = bbBond(bbWallUV(), vec2(0.34, 0.17), 0.09, 0.35);
  vec3 stone = bbBase * (0.8 + 0.34 * b.y);
  diffuseColor.rgb = mix(bbBase, mix(stone, bbBase * 0.62, b.x), b.z);
} else if (bbSurface == 15 || (bbSurface == 3 && !bbWall)) {
  float size = bbSurface == 15 ? 0.33 : 0.2;
  vec2 uv = vPatternPosition.xz / size;
  vec2 f = fract(uv);
  vec2 w = fwidth(uv);
  float joint = 1.0 - smoothstep(0.05 - w.x, 0.05 + w.x, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  float visible = 1.0 - smoothstep(0.18, 0.42, max(w.x, w.y));
  vec3 slab = bbBase * (0.92 + 0.14 * bbHash(floor(uv)));
  diffuseColor.rgb = mix(bbBase, mix(slab, bbBase * 0.78, joint), visible);
} else if (bbSurface == 12 && bbWall) {
  vec2 uv = bbWallUV();
  float a = sin(uv.x * 2.3 + uv.y * 1.4) + sin(uv.x * 0.9 - uv.y * 3.1 + 1.7) + 0.6 * sin(length(uv - vec2(0.4, 1.2)) * 5.0);
  int idx = int(mod(floor(a * 1.4 + 6.0), 6.0));
  vec3 paint = uMural[0];
  for (int i = 1; i < 6; i++) if (i == idx) paint = uMural[i];
  float visible = 1.0 - smoothstep(0.25, 0.6, fwidth(a * 1.4));
  diffuseColor.rgb = mix(bbBase, paint, 0.9 * visible);
} else if (bbSurface == 14) {
  float u = (bbWall ? bbWallUV().x : vPatternPosition.x) * 22.0;
  float visible = 1.0 - smoothstep(0.3, 0.7, fwidth(u));
  diffuseColor.rgb *= 1.0 - 0.13 * visible * (0.5 + 0.5 * sin(u * 6.2832));
} else if (bbSurface == 0 || bbSurface == 2 || bbSurface == 13) {
  float scale = bbSurface == 2 ? 7.0 : 2.6;
  vec2 uv = bbWall ? bbWallUV() : vPatternPosition.xz;
  float n = bbNoise(uv * scale) * 0.6 + bbNoise(uv * scale * 3.7) * 0.4;
  diffuseColor.rgb *= 0.95 + 0.1 * n;
} else if (bbSurface == 7) {
  float n = bbNoise(vPatternPosition.xz * 5.0 + vPatternPosition.y * 3.0);
  diffuseColor.rgb *= 0.82 + 0.3 * n;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.06, 0.86), clamp(vPatternNormal.y, 0.0, 1.0) * 0.6);
} else if (bbSurface == 8) {
  float n = bbNoise(vPatternPosition.xz * 0.9) * 0.65 + bbNoise(vPatternPosition.xz * 6.0) * 0.35;
  diffuseColor.rgb *= 0.92 + 0.14 * n;
  #ifndef BARRIO_ENVIRONMENT
  float meadow = smoothstep(0.35, 0.8, bbNoise(vPatternPosition.xz * 0.16 + 3.7));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.05, 0.84), meadow * 0.4);
  #endif
} else if (bbSurface == 16) {
  #ifndef BARRIO_ENVIRONMENT
  float n = bbNoise(vPatternPosition.xz * 2.2 + vec2(0.0, vPatternPosition.x * 0.3));
  diffuseColor.rgb *= 0.93 + 0.12 * n;
  #endif
} else if (bbSurface == 9 && bbWall) {
  float v = vPatternPosition.y * 7.0 + bbNoise(vec2(bbWallUV().x * 1.3, vPatternPosition.y)) * 2.2;
  diffuseColor.rgb *= 0.86 + 0.16 * (0.5 + 0.5 * sin(v));
}
`;
const roughnessBody = /* glsl */ `
{
  int s = int(vSurface + 0.5);
  #ifdef BARRIO_ENVIRONMENT
  // Calm, matte water: no sun glare that would read as a reflection pass the scene does not have.
  float water = 0.86;
  #else
  float water = 0.6;
  #endif
  roughnessFactor = s == 6 ? 0.22 : s == 16 ? water : s == 4 ? 0.5 : s == 14 ? 0.55 : s == 3 ? 0.72 : s == 11 ? 0.78 : 0.94;
}
`;
const metalnessBody = /* glsl */ `
{
  int s = int(vSurface + 0.5);
  metalnessFactor = s == 4 || s == 14 ? 0.32 : s == 6 ? 0.12 : 0.0;
}
`;
const emissiveBody = /* glsl */ `
if (int(vSurface + 0.5) == 6 && uGlow > 0.0) {
  float lit = step(bbHash3(floor(vPatternPosition * 1.6)), 0.62);
  totalEmissiveRadiance += vec3(1.0, 0.68, 0.36) * uGlow * lit;
}
`;

function patch(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uGlow = glow;
  shader.uniforms.uMural = { value: muralColors.map((name) => new THREE.Color(PALETTE[name])) };
  Object.assign(shader.uniforms, environmentUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${vertexHeader}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${vertexBody}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${fragmentHeader}`)
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>\n#ifdef BARRIO_ENVIRONMENT\n${environmentBody}\n#endif\n#ifdef BARRIO_PATTERNS\n${fragmentBody}\n#endif`,
    )
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${roughnessBody}`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${metalnessBody}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emissiveBody}`);
}

type WithDefines = THREE.Material & { defines?: Record<string, string> };

/** Shader features toggled through defines; three.js keys compiled programs by them. */
const features = { patterns: true, environment: false };
function defines(): Record<string, string> {
  return {
    ...(features.patterns ? { BARRIO_PATTERNS: '' } : {}),
    ...(features.environment ? { BARRIO_ENVIRONMENT: '' } : {}),
  };
}

/** Every live world material, so a feature toggle reaches the placement ghost as well as the board. */
const materials = new Set<THREE.MeshStandardMaterial>();

/**
 * A material with the world's patterns and environment grading. The board shares `worldMaterial`; the
 * placement ghost makes its own translucent one, which follows every later feature toggle until disposed.
 */
export function createWorldMaterial(
  parameters: Pick<THREE.MeshStandardMaterialParameters, 'transparent' | 'opacity' | 'depthWrite'> = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    ...parameters,
  });
  (material as WithDefines).defines = defines();
  material.onBeforeCompile = patch;
  material.customProgramCacheKey = () => 'barrio-world-v4';
  materials.add(material);
  material.addEventListener('dispose', () => materials.delete(material));
  return material;
}

function syncDefines(): void {
  for (const material of materials) {
    (material as WithDefines).defines = defines();
    material.needsUpdate = true;
  }
}

/** Procedural micro-patterns cost about a third of render time on software rasterizers; the low tier skips them. */
export function setPatterns(enabled: boolean): void {
  features.patterns = enabled;
  syncDefines();
}

/**
 * Applies an environment on every quality tier, with the world seed placing its field, or restores legacy
 * colors with `null`.
 */
export function setEnvironment(config: { environment: ResolvedEnvironment; seed: number } | null): void {
  if (config) {
    const { environment } = config;
    const u = environmentUniforms;
    u.uEnvFoliage.value.copy(environment.gains.foliage);
    u.uEnvFoliageSaturation.value = environment.foliageSaturation;
    u.uEnvStone.value.copy(environment.gains.stone);
    u.uEnvSoil.value.copy(environment.gains.soil);
    u.uEnvPaving.value.copy(environment.gains.paving);
    for (const [i, tint] of environment.canopy.entries()) u.uCanopy.value[i]?.copy(tint);
    const frame = fieldFrame(config.seed);
    const { ground } = environment;
    u.uField.value.set(frame.offsetX, frame.offsetZ, ground.patchSize, ground.patchContrast);
    u.uFieldSalt.value = frame.salt;
    u.uGroundMeadow.value.set(...ground.meadow);
    u.uGroundLush.value.set(...ground.lush);
    u.uGroundDry.value.set(...ground.dry);
    u.uWaterBody.value.copy(environment.water.body);
    u.uWaterDeep.value.copy(environment.water.deep);
    u.uWaterHighlight.value.copy(environment.water.highlight);
    u.uWaterEdge.value.copy(environment.water.edge);
  }
  if (features.environment === !!config) return;
  features.environment = !!config;
  syncDefines();
}

/** Read-only view of the active shader features and uniforms, for diagnostics and tests. */
export function materialFeatures(): Readonly<typeof features> {
  return { ...features };
}
export function environmentUniformValues(): Readonly<typeof environmentUniforms> {
  return environmentUniforms;
}

export const worldMaterial = createWorldMaterial();
