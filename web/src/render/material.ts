import * as THREE from 'three';
import { PALETTE } from './palette';

/**
 * One shared material for every opaque surface in the world. Geometry carries a `surface` attribute and
 * vertex colors; the shader adds world-space procedural detail (brick coursing, stone, paving, murals) so a
 * single draw call per geometry batch still reads as distinct materials. Patterns fade out as they approach
 * pixel size (fwidth), which keeps the orthographic view free of moiré at every zoom level.
 */
export const glow = { value: 0 };
const muralColors = ['coral', 'mustard', 'turquoise', 'dustyBlue', 'mutedGreen', 'offWhite'] as const;

const vertexHeader = /* glsl */ `
attribute float surface;
varying float vSurface;
varying vec3 vPatternPosition;
varying vec3 vPatternNormal;
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
`;
const fragmentHeader = /* glsl */ `
varying float vSurface;
varying vec3 vPatternPosition;
varying vec3 vPatternNormal;
uniform float uGlow;
uniform vec3 uMural[6];
float bbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bbHash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
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
  float meadow = smoothstep(0.35, 0.8, bbNoise(vPatternPosition.xz * 0.16 + 3.7));
  diffuseColor.rgb *= 0.92 + 0.14 * n;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.05, 0.84), meadow * 0.4);
} else if (bbSurface == 9 && bbWall) {
  float v = vPatternPosition.y * 7.0 + bbNoise(vec2(bbWallUV().x * 1.3, vPatternPosition.y)) * 2.2;
  diffuseColor.rgb *= 0.86 + 0.16 * (0.5 + 0.5 * sin(v));
}
`;
const roughnessBody = /* glsl */ `
{
  int s = int(vSurface + 0.5);
  roughnessFactor = s == 6 ? 0.22 : s == 4 ? 0.5 : s == 14 ? 0.55 : s == 3 ? 0.72 : s == 11 ? 0.78 : 0.94;
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
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${vertexHeader}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${vertexBody}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${fragmentHeader}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${fragmentBody}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${roughnessBody}`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${metalnessBody}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emissiveBody}`);
}

export function createWorldMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  material.onBeforeCompile = patch;
  material.customProgramCacheKey = () => 'barrio-world-v1';
  return material;
}

export const worldMaterial = createWorldMaterial();
