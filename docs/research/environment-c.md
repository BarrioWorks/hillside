# Environment research C

Research date is 2026-10-21. This is a read-only investigation of the installed Three.js 0.180.0 and `web/src/render`. No rendering changes were applied. Recommendations below are candidates for Milestone 1. Visual gains and runtime costs are predictions unless explicitly marked as observed.

throughput checkpoint: n/a, read-only investigation

## Recommendation

Keep the existing building geometry, shared material, and instancing. Make the environment painterly through regional color relationships, broad terrain patches, restrained foliage variation, and controlled atmosphere. Keep Neutral as the default tone mapper. Compare AgX before adopting it. Dorfromantik is an art-direction reference for miniature scale and connected landscape masses, not an asset or palette source. The regional treatments below are proposed art direction, not researched botanical claims.

Milestone 1 should apply recommendations 1 through 5 first. Recommendation 6 is a bounded addition if vegetation still looks repetitive. Recommendation 7 is optional texture hygiene rather than a reason to introduce textures.

## Observed pipeline

- `world.ts:158-173` selects low or high quality, sets sRGB output and Neutral tone mapping, uses 1024 PCF or 2048 PCFSoft shadows, and disables automatic shadow updates.
- `lighting.ts` owns one directional sun, hemisphere fill, a correctly tagged sRGB canvas sky, regional afternoon skies, and linear fog fixed at 60 to 140. Afternoon sun intensity is 3 and hemisphere intensity is 2. Those numbers alone do not establish overexposure.
- `palette.ts`, `builder.ts:10-16,40-48`, and `ground.ts:101-107` construct `THREE.Color` from sRGB hex strings and upload the resulting linear RGB components. This path already follows Three.js color management.
- `material.ts` patches `MeshStandardMaterial`, retaining lighting, tone mapping, output conversion, and fog. Surface IDs choose procedural details. Low quality disables the pattern branch. `Builder.finish()` also bakes darkening near the bottoms of vertical faces.
- `ground.ts` merges terrain, blends equal-height neighbors at corners, and uses deterministic coordinate jitter. `tiles.ts:882` uses seeded decoration placement. `StructureBatches` groups by geometry, material, shadow flags, layer, and render order. It already uploads changed matrix ranges, maintains conservative bounds, and bakes reflections to keep instance determinants positive.
- I inspected `web/tests/game.spec.ts-snapshots/developed-linux.png`. In that stored low-quality baseline, broad ground areas have similar tones and repeated green crowns merge visually. This is an interpretation of an existing screenshot, not a fresh capture of current runtime behavior.

## Milestone 1 changes

### 1. Preserve the color contract and author regional colors in OKLCH

Observed problem. `ground.ts:102-107` shifts regions by adding a linear RGB delta and varies brightness with a scalar. This is deterministic but gives little direct control over perceived lightness and chroma. The existing hex-to-linear upload is correct and needs no gamma correction.

Official facts. Three.js uses Linear-sRGB for vertex colors and defaults to automatic conversion of hex inputs. Color textures need sRGB annotation, while normal and roughness data use `NoColorSpace`. Output normally uses sRGB. [Three.js color management](https://threejs.org/manual/pages/color-management.html). OKLCH expresses lightness, chroma, and hue separately. Its available chroma depends on the destination gamut. [CSS Color 4](https://www.w3.org/TR/css-color-4/#specifying-oklab-oklch). The installed `Color.setStyle()` does not parse OKLCH. [r180 Color source](https://github.com/mrdoob/three.js/blob/r180/src/math/Color.js).

Technique. Author a small bounded regional ramp outside the render loop, convert and gamut-map it to sRGB hex, then pass it through the current `THREE.Color(hex)` path once. Keep terrain neighbor interpolation in linear RGB. Suggested starting directions are deeper coffee greens for Salento, drier yellow-green and sand for Cartagena, cooler lower-chroma greens for Bogotá, and warm soil against muted greens for Medellín. Treat these as original palette choices. Keep building colors intact.

Complexity is low for precomputed ramps and medium for a reusable converter. Predicted visual gain is clearer regional identity without random color clashes. Runtime cost is unchanged for stored hex ramps. Verification should assert finite in-gamut outputs and exact replay of generated colors. Capture the same developed board in each region with identical lighting and camera settings. Do not judge palette fidelity from lit pixels alone.

### 2. Keep Neutral and calibrate light before changing the tone mapper

Observed problem. `world.ts:169` already uses Neutral. `lighting.ts` has exposure and fill presets, but the existing screenshot baselines cover only low quality. There is no inspected evidence that replacing Neutral would improve this scene.

Official facts. r180 Neutral compresses highlights and desaturates their peaks. AgX adds a log-domain contrast transform. ACESFilmic uses a fitted transform and an exposure scaling factor of `1 / 0.6`. These are different transforms, not interchangeable exposure presets. [r180 tone-mapping implementation](https://github.com/mrdoob/three.js/blob/r180/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js). The PBR Neutral author documents its emphasis on reachable saturated colors compared with cinematic transforms. [PBR Neutral design](https://modelviewer.dev/examples/tone-mapping).

Technique. Retain Neutral. Compare Neutral, AgX, and ACES on one fixed board. First hold exposure constant to expose the transform differences, then compare after matching a matte gray reference. Tune hemisphere fill and exposure for readable tree undersides and cream plaster. AgX is a candidate if its highlight compression improves the scene without losing turquoise and terracotta separation. ACES is a useful comparison, not the recommended default. Neither provides brush texture.

Complexity is low. Predicted visual gain is preserved palette separation and more deliberate light contrast. Cost stays unchanged with Neutral. AgX adds shader arithmetic but no new render pass; no timing claim is made. Verification needs all three lighting presets and both quality tiers, with crops of foliage, cream plaster, turquoise walls, water, and evening windows. Reject a switch that erases those distinctions.

### 3. Replace fine landscape noise with broad deterministic patches

Observed problem. `material.ts` samples foliage noise at scale 5 and grass noise at scales 0.9 and 6. Low quality skips all of this. `ground.ts` varies each tile by only a 0.985 to 1.015 linear multiplier. Consequently, the broad landscape color design depends on a narrow range in low quality.

Evidence. Three.js vertex colors can carry baked linear RGB variation without a color texture. [Three.js color management](https://threejs.org/manual/pages/color-management.html). Existing `groundGeometry()` already interpolates those colors across terrain triangles. The painterly benefit is an art-direction inference, not a promise from Three.js.

Technique. Bake a low-frequency world-coordinate color field into existing ground vertices at construction time. Start with patches roughly two to four hex widths across. Sample shared positions consistently so neighboring tiles retain matching edge colors. Use an independent hash namespace with coordinates, world seed, region, and a visual version. Keep this separate from gameplay randomness. Retain subtle shader noise only as secondary detail on high quality. Do not add subdivisions before checking the existing mesh.

Complexity is medium. Predicted gain is connected meadow masses visible at normal zoom and on low quality. Cost is CPU work during ground rebuilding, with no extra attributes or draw calls if existing color attributes suffice. Verification should compare color arrays after reload and reversed tile input order, compare equal-level shared corners, and confirm simulation snapshots do not change. Capture full-board and close terrain views at both tiers, including a three-tile junction and an elevation step.

### 4. Tune r180 shadows with a filter that actually supports the chosen control

Observed problem. High quality uses `PCFSoftShadowMap`. Increasing `sun.shadow.radius` on that path would have no effect in r180. `Lighting.frame()` expands the shadow volume with neighborhood radius, which changes world-space texel size as the board grows.

Official facts. r180 PCF multiplies sampling offsets by `shadowRadius`; PCFSoft uses a fixed texel-sized filter. [r180 shadow shader](https://github.com/mrdoob/three.js/blob/r180/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js). Shadow resolution and fitted camera area trade quality against memory and computation. [Three.js shadows manual](https://threejs.org/manual/pages/shadows.html). Bias can reduce acne but distort or detach shadows. [r180 LightShadow](https://github.com/mrdoob/three.js/blob/r180/src/lights/LightShadow.js).

Technique. Keep the current PCFSoft result as the baseline. Compare high quality PCF with radius values near 1.5 and 2 at the existing 2048 resolution. Fit the sun camera to caster and receiver bounds in light space, including tall palms and elevated buildings, before increasing map size. Stabilize the fitted center on the shadow texel grid if growth causes visible shifts. Preserve demand-driven shadow updates and existing baked contact darkening. Tune bias only against observed artifacts.

Complexity is low for a filter comparison and medium for fitting. Predicted gain is softer, more stable grounding. Both filters have sampling costs; changing radius within PCF does not add taps. Fitting adds CPU work when bounds change. Verification needs roof, palm, stair, and retaining-wall crops at opening and developed sizes. Check acne, detached contacts, clipping, growth-related shadow jumps, and unchanged shadow-update counts during idle frames. Defer VSM, PCSS, and screen-space AO from Milestone 1.

### 5. Make fog consistent with the orthographic camera

Observed problem. `Lighting` fixes fog at 60 to 140. `world.ts:284` initially positions the camera about 42 units from the origin, while `setView()` forces an 80-unit radius. This can alter fog without an intended atmospheric change. This is a source-derived risk, not a reproduced runtime defect.

Official facts. The manual describes fog through near and far distances. [Three.js fog manual](https://threejs.org/manual/pages/fog.html). More precisely, r180 supplies negative view-space Z, not radial Euclidean distance, to its fog calculation. [r180 fog vertex shader](https://github.com/mrdoob/three.js/blob/r180/src/renderers/shaders/ShaderChunk/fog_vertex.glsl.js). Linear fog then uses `smoothstep(near, far, depth)`. [r180 fog fragment shader](https://github.com/mrdoob/three.js/blob/r180/src/renderers/shaders/ShaderChunk/fog_fragment.glsl.js).

Technique. Calculate fog near and far relative to the board center's view-space depth and projected board extent when the camera changes. Keep the playable center almost clear and introduce restrained far-edge haze. Continue matching fog color to the sky horizon. Prefer this to adding FogExp2, which does not solve the camera relationship.

Complexity is medium. Predicted gain is stable color and restrained depth separation across views. Cost is a few CPU transforms on camera changes with the same fog shader. Verification should compare the same centered board at home, explicit `view()`, several polar angles, and zoom extremes. Record fog factors at the board center and extremities. Check that narrow paths and dark foliage remain distinguishable.

### 6. Add bounded variation to vegetation instances if needed

Observed problem. `models.ts:tree()` alternates `leaf` and `leafDeep`. `tiles.ts:960-968` reuses a small cached tree family. `StructureBatches` currently has no instance-color lifecycle. Rebuilding buildings or creating one material per tree would discard useful existing batching.

Official facts. InstancedMesh supports per-instance colors, requires dirty flags after edits, and needs valid bounds after matrix changes. [InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html). Its color multiplies vertex color rather than replacing it. [r180 vertex-color shader](https://github.com/mrdoob/three.js/blob/r180/src/renderers/shaders/ShaderChunk/color_vertex.glsl.js).

Technique. Apply a small deterministic tint only to tree and shrub parts. Hash placement identity independently from geometry selection. Keep white for untinted parts. Initialize instance colors before first rendering and update dirty ranges after edits. Copy color alongside the matrix when removal swaps the last slot into a hole. A whole-tree tint also affects its trunk, so keep it restrained; use foliage vertex colors if crown-only variation is needed. Preserve reflected-geometry handling and conservative bounds.

Complexity is medium. Predicted gain is less repeated vegetation without additional tree geometry. A Float32 RGB instance-color attribute uses 12 bytes per allocated slot, plus uploads and a vertex multiplication. No extra draw call is required for color alone. Verification should extend `batches.test.ts` to cover swap removal, picking identity, white defaults, and color persistence after transforms. Compare dense forests at both tiers and require unchanged batch counts.

### 7. Keep texture additions optional and correctly tagged

Observed problem. `Builder.add()` deletes UVs. The world material already provides world-space patterns. A conventional painted atlas would require extra geometry plumbing. `debug.ts:68-69` creates a colored canvas texture without an explicit color-space assignment, unlike the sky texture.

Official facts. Texture color-space annotation depends on whether pixels represent display colors or numeric data. Shader uniforms and vertex colors already use the linear working space. [Three.js color management](https://threejs.org/manual/pages/color-management.html).

Technique. Prefer the baked color patches above for Milestone 1. If a later grain texture is necessary, use one small repeatable world-space sample. Mark a painted color map sRGB. Leave a numeric modulation mask `NoColorSpace`; grayscale alone does not determine its meaning. Tag the colored debug canvas sRGB when touching that code. Do not add UVs to all buildings for paper grain.

Complexity is low for annotation and medium for a shader sample. Predicted gain is correct colored labels and optional controlled surface grain. Annotation adds no render pass; grain adds texture storage and sampling per affected fragment. Verify debug-label colors against their intended swatches. Compare grain on and off at three zoom levels and reject shimmer or visible repetition.

## Verification handoff

The installed package reports revision 180. A read-only Node assertion probe confirmed enabled color management, `new Color('#808080').r === 0.21586050010324417`, unsupported OKLCH strings leaving the previous color unchanged with a warning, PCFSoft ignoring radius, and 12-byte Float32 RGB instance-color slots. These checks did not render a frame or measure performance.

Reuse `web/tests/game.spec.ts:312-327`, which captures seed 2026 at opening and after 50 autoplay placements. Add a separate explicit high-quality capture because its current baseline URL forces `quality=low`. Use fixed viewport, device scale, camera, region, lighting, and settled animation. Save diagnostic crops alongside full-board captures. Keep a fixed browser and graphics backend for pixel comparisons. Across devices, test generated attributes and gameplay state rather than promising identical pixels.

After implementation, run the relevant ground, batches, and tiles tests, then the opening and developed browser cases. Extend tests for the new behavior described above. No new tests or screenshots were written during this research. Do not approve snapshots merely because the renderer changed. Check shared terrain edges, path readability, contact shadows, regional identity, and unchanged buildings first.

The Prove It Works principle shaped this report by requiring checks against the installed package rather than assuming current online documentation matches r180. Type System Discipline shaped the proposed regional ramps toward an exhaustive region mapping. The user's prohibition on further agents took precedence over the how skill's delegation workflow.
