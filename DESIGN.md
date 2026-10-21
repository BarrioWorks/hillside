---
name: "Barrio Builder"
description: "A sunlit hillside miniature with compact floating controls."
colors:
  blue: "#245beb"
  secondary: "#53647b"
  surface: "#fff"
  line: "#d9e2ed"
  ink: "#17212f"
  atmosphere: "#d9e6e2"
  cloud: "#f4f7fb"
  hover: "#edf2fa"
  action-deep: "#1948c3"
  selected: "#edf2ff"
  model-selected: "#f1f5ff"
  keycap: "#edf1f6"
  border-strong: "#a8b8ca"
  divider-soft: "#edf0f5"
  menu-divider: "#e8eef5"
  selection-surface: "#ffffffed"
  sun-surface: "#ffffff9c"
  sun-ink: "#526e5e"
  caption-ink: "#344e44"
  caption-secondary: "#50665b"
  caption-line: "#637f6b"
  hint-ink: "#344f44"
  hint-muted: "#6e8579"
  hint-dot: "#387954"
  feedback-danger: "#a31f31"
  feedback-danger-surface: "#fff7f7"
  placement-danger: "#b42336"
  world-plaster: "#e8e6d8"
  world-concrete: "#b8b8a7"
  world-window: "#294a4c"
  world-metal: "#4c6260"
  world-brick: "#b56d4e"
  world-leaf: "#387b4d"
  world-ground: "#c7d4bf"
  world-mountain: "#91b2a2"
  world-trunk: "#7c7657"
  world-sky-light: "#edf4ff"
  world-ground-light: "#afab87"
  world-sun-light: "#ffefcf"
  thumbnail-sky-light: "#edf4fc"
  thumbnail-ground-light: "#a6a58d"
  thumbnail-sun-light: "#fff0d4"
  world-casa-0: "#e9b44c"
  world-casa-1: "#cf8066"
  world-casa-2: "#8bb4b4"
  world-tienda-0: "#e77c65"
  world-tienda-1: "#d6a14f"
  world-tienda-2: "#83a99e"
  world-torre-0: "#b96547"
  world-torre-1: "#ab674f"
  world-torre-2: "#c07855"
  world-terraza-0: "#69aeb5"
  world-terraza-1: "#8ba788"
  world-terraza-2: "#cf987a"
  world-taller-0: "#cb8063"
  world-taller-1: "#b18b68"
  world-taller-2: "#9aa6a0"
  world-esquina-0: "#e7d8b5"
  world-esquina-1: "#c8d4cc"
  world-esquina-2: "#d5b1a0"
typography:
  display:
    fontFamily: "Fraunces, serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 0.9
    letterSpacing: "-0.035em"
  display-mobile:
    fontFamily: "Fraunces, serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 0.9
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Fraunces, serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Fraunces, serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  caption:
    fontFamily: "Fraunces, serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  dialog-body:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  help-body:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  button:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 700
  label:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 800
    lineHeight: 1.2
  metadata:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.6
  collection-title:
    fontFamily: "Fraunces, serif"
    fontSize: "38px"
    fontWeight: 600
  collection-title-mobile:
    fontFamily: "Fraunces, serif"
    fontSize: "29px"
    fontWeight: 600
  loading-mark:
    fontFamily: "Fraunces, serif"
    fontSize: "72px"
    fontWeight: 600
rounded:
  keycap: "4px"
  feedback: "8px"
  control: "10px"
  camera: "12px"
  toolbar: "14px"
  panel: "16px"
  palette: "17px"
  dialog: "18px"
  circle: "50%"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
  space-8: "32px"
components:
  button-ghost:
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px"
  button-save:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-dialog-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px"
  palette-tab-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.action-deep}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  palette:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.palette}"
    padding: "8px 10px 10px"
  selection-strip:
    backgroundColor: "{colors.selection-surface}"
    rounded: "{rounded.control}"
    padding: "5px 7px 5px 16px"
  help-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "21px 24px"
    width: "330px"
  placement-feedback:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.action-deep}"
    rounded: "{rounded.feedback}"
    padding: "9px 12px"
---

# Design System: Barrio Builder

## Overview

**Creative North Star: "A neighborhood built one useful piece at a time"**

A neighborhood built one useful piece at a time. The implemented world is a sunlit, terraced miniature: warm architectural plaster and brick, small plants, stairs, and paths under an orthographic camera.

Compact white floating controls sit above the scene. Cobalt carries actions and selection, while brand-pinned Fraunces and Nunito Sans provide character and legibility. The architecture-only warm palette exception in PRODUCT.md and docs/implementation-contract.md does not extend to interface surfaces.

**Key Characteristics:**
- Full-viewport orthographic miniature with compact floating controls.
- Cool white interface surfaces and cobalt action states.
- Warm, varied architecture with matte materials and soft scene shadows.
- Brand-pinned Fraunces display type and Nunito Sans interface type.

This is a source-based record of the completed implementation, refreshing the incumbent direction. Source locations below identify declarations rather than new shared CSS variables. Only `--blue`, `--secondary`, `--surface`, `--shadow`, and `--line` are CSS custom properties; the other documented tokens are extracted literals. BRAND.md supplies identity; implemented game values win over its proposed generic scales.

Verification context: the user reports nine production browser tests passed. This documentation pass ran no browser, build, test, or benchmark. The independent `docs/verification/final-review.md` ship disposition covers only dismissal of the unsupported reset finding and resolution of the mobile Save accessible name; its evidence snapshot predates the reported nine-test completion. Hardware FPS remains unverified.

## Colors

The palette separates cool functional controls from sunlit architectural materials. Frontmatter holds exact reusable color values; renderer lighting changes their on-screen appearance.

### Primary

- **Barrio cobalt** (`blue`): primary Save/dialog actions, selected model border, focus, valid footprint and ghost. Source: `web/src/style.css` :root, button focus, .save-button, button.primary, .model-button; `web/src/render/world.ts` ghostMaterial and updatePreview.
- **Deep action blue** (`action-deep`), **selected wash** (`selected`), and **model wash** (`model-selected`): selected tools, category tabs, model cards, and placement feedback. The deeper Save hover declaration is present but does not win the cascade; see Do's and Don'ts.

### Secondary

- **Architectural families** (`world-casa-0` through `world-esquina-2`): the exact three facade variants per building, indexed as in `web/src/render/models.ts` variants. Mustard, coral, brick, turquoise, cream plaster, and concrete tones belong to buildings.
- **Material colors** (`world-plaster`, `world-concrete`, `world-window`, `world-metal`, `world-brick`, `world-leaf`): shared model constants in `web/src/render/models.ts`; vertex-color MeshStandardMaterial uses roughness 0.9. Small one-off architectural details stay in that source rather than becoming house tokens.
- **Landscape and light** (`world-ground`, `world-mountain`, `world-trunk`, the light tokens): `web/src/render/terrain.ts`, `world.ts`, and `thumbnails.ts`. Scene invalid/removal preview uses `placement-danger`; DOM invalid feedback uses `feedback-danger` and `feedback-danger-surface`. These are distinct implemented colors, not a unified semantic ramp.

### Neutral

- **Clean white**, **cloud**, **ink**, **secondary**, and **line**: panels, collection background/model hover, default text, supporting text, and dividers. Sources: `web/src/style.css` :root, .contact-page, .model-button:hover, .history, .palette-tools.
- **Atmosphere**: root background, renderer background/fog, and caption text-shadow. **Selection surface** and **sun surface** retain source alpha instead of flattening to opaque white. **Caption** and **hint** families support text against the landscape. Sources: .selection-line, .sun, .scene-caption, .bottom-hints.
- **Hover**, **keycap**, **border-strong**, **divider-soft**, and **menu-divider**: button hover, keyboard hints, scrollbar thumb, palette/help separators, and file-menu rule respectively.

**The World and Controls Rule.** Keep warm plaster and brick in the game world; keep interface surfaces cool white and gray.

## Typography

**Display Font:** Fraunces, serif. **Body Font:** Nunito Sans, sans-serif. These remain pinned. `web/src/style.css` imports Fraunces 600 and Nunito Sans 400/600/700/800 locally through @fontsource. There is no implemented monospace role; kbd inherits the interface font.

### Hierarchy

- **Display:** .brand > span; mobile override at max-width 600px. The brand inherits root weight 400 even though only Fraunces 600 is imported and font-synthesis is none; the frontmatter records the inherited weight, without claiming a separately loaded 400 face.
- **Headline / title:** dialog h2 and .help-panel h2.
- **Caption:** .scene-caption; reduced to 16px at max-width 1000px, hidden at max-width 600px.
- **Body:** root base; dialog p and help paragraphs/dd have explicit prose line heights. Root body has no explicit line-height token.
- **Buttons / labels / metadata:** base button, .model-button span, .model-button small. Category tabs are 12px/700, mobile 10px/700; model labels become 11px on mobile. Selection title is 13px/800, mobile 12px. Help labels are 12px/800; keycaps 11px/700. Supporting labels and hints reach 10px; these compact values are not a general reading-text recommendation.
- **Collection / loading:** .contact-page h1 and its mobile override; .loading-mark. Collection article titles are 17px/700.

**The Brand Pairing Rule.** Keep Fraunces for expressive titles and Nunito Sans for everyday controls; keycaps inherit the interface family.

## Layout

Source: `web/src/style.css` #app, #world, .topbar, .view-tools, .bottom-ui, .palette-items, and media queries. The viewport uses 100dvw/100dvh and body overflow hidden; the collection route restores scrolling. Topbar is inset 30px horizontally and 24px vertically. Camera controls sit at right 30px and top calc(50% - 84px). Bottom UI centers at bottom 22px with width min(720px, calc(100% - 40px)). Selection strip sits above the palette. Six desktop model cards share the row; horizontal scrolling supports overflow. There is no permanent large sidebar.

The observed 4/8/12/16/20/24/32px rhythm coexists with component-specific 3/5/6/7/9/10px gaps and padding; it is not an enforced spacing grid. Buttons have minimum width and height 44px. The decorative sun is 36px, not a button target.

- **At min-width 1500px:** bottom UI 770px; model thumbnails 84px and cards at least 118px high; scene caption bottom 38px.
- **At max-width 1000px:** neighborhood summary and desktop hints disappear; topbar uses 22px horizontal/20px top insets, bottom UI bottom 18px.
- **At max-width 600px:** topbar 16px horizontal/15px top; Save text, topbar sound/help, and scene caption disappear. Save keeps its button-level aria-label; sound/help remain in the menu. Bottom UI width calc(100% - 24px), bottom max(12px, env(safe-area-inset-bottom)). Palette radius becomes 14px; model cards use flex 0 0 74px, minimum width 72px, minimum height 104px, thumbnails 72px. Tabs compact but retain 44px minimum height.

Renderer spatial rules: `web/src/render/terrain.ts` STEP is 0.55 world units and cells are 1 unit horizontally. `world.ts` uses an orthographic camera, initial position (43,34,48), target (16,1,16), zoom limits 0.65–3.5 and polar limits 0.28–1.25 radians. Terrain colors are deterministic formulas, recorded in sidecar extensions rather than misrepresented as fixed CSS swatches.

## Elevation & Depth

Soft ambient shadows lift controls off the miniature; they are structural separators rather than hard offset decoration. Exact shadow strings are in the sidecar: toolbar/camera/storage/loading share --shadow; palette, selection strip, feedback, popover/help, and modal each retain their source shadows. The dialog backdrop uses translucent ink. Caption text-shadow maintains separation against the scene.

The renderer uses sRGB output, ACES filmic tone mapping, exposure 1.15, fog from 60 to 150, and PCF soft shadows. Main hemisphere intensity is 2.3; sun intensity is 3.3 at (-12,34,23). Shadow maps are 512px low quality and 2048px high quality. Thumbnail lighting intentionally differs: hemisphere 2.4, sun 3.1 at (-5,9,7), same exposure, transparent background. Sources: `web/src/render/world.ts` constructor and `thumbnails.ts` lighting/thumbnails. These settings describe appearance, not a performance guarantee.

**The Floating Surface Rule.** Use soft shadows to separate compact controls from the scene, preserving the open canvas.

## Shapes

Source: `web/src/style.css` button, kbd, .placement-feedback, .top-actions, .view-tools, .palette, .selection-line, .help-panel, dialog, and .contact-grid article. Gently rounded rectangles distinguish controls, grouped toolbars, and larger overlays. Radius tokens name these observed roles rather than imposing the unimplemented BRAND.md scale. The sun and status dot are circles. Model selection adds a 1.5px cobalt border; ordinary controls use no border. Renderer buildings use stacked blocks, flat roofs, parapets, balcony rails, grilles, tanks, and small plants, with architectural silhouette differences in `web/src/render/models.ts` architecture.

## Components

### Buttons and action groups

Compact, familiar controls. Base button padding and geometry live in frontmatter; gap is 8px, weight 700, transition 160ms for background/color/transform. Active translates down 1px; disabled opacity is 0.3, transform none, transparent hover. Generic hover uses the hover wash. Focus-visible is a 3px cobalt outline offset 4px on buttons, links, and canvas; #world overrides offset to -4px. Save has horizontal margin 3px and mobile padding 8px/margin 0 1px. Dialog primary uses the base 10px padding. Source: `web/src/style.css` base button and variants; `web/src/ui.ts` button helper/constructor.

### Category navigation and model cards

Tabs use aria-selected; tool/model buttons use aria-pressed. Model cards have a transparent 1.5px border at rest, cloud hover, selected model wash and cobalt border, 76px thumbnails, 12px/800 labels, and 10px/600 footprints. Desktop minimum card height is 109px. Source: `web/src/style.css` .palette* and .model-button*; `web/src/ui.ts` renderPalette/update. Thumbnails are actual rendered catalog models, not icon substitutions; sidecar snippets omit thumbnail assets rather than inventing replacements.

### Floating containers and feedback

Palette, selection strip, file menu (290px, padding 12px), help panel, storage warning, and modal use white/alpha-white surfaces with role-specific radii and shadows. File menu width becomes 275px on mobile. Selection strip title/description and rotate button provide context. Placement feedback combines check/close/trash SVG, reason text, and scene footprint; invalid styling is separate from scene preview color. Live status uses role=status/aria-live=polite. Source: `web/src/style.css` relevant selectors and `web/src/ui.ts` constructor/update.

### Dialog and fields

Native dialog has radius 18px, padding 30px, width 420px bounded by calc(100vw - 32px), with right-aligned actions and gap 10px. Reset confirmation remains unchanged. Import uses a hidden native file input; there is no visible text-field design to document or synthesize. Source: `web/src/style.css` dialog* and `web/src/ui.ts` constructor.

### Motion and scene feedback

Source: `web/src/render/world.ts` ghostMaterial, updatePreview, constructor, and frame. Valid placement is cobalt; invalid/removal is danger, combined with footprint geometry and DOM reason text. Ghost opacity is 0.53; marker opacity 0.4. Placement grows vertically over 240ms with a cubic ease-out formula from 0.35 to 1. Orbit damping factor is 0.1 and is disabled for reduced motion; reduced motion also bypasses placement animation. CSS reduced-motion query removes transitions/animations and restores auto scroll behavior. Sound begins after explicit player interaction, with mute controls (`web/src/sound.ts`, `web/src/ui.ts`).

## Do's and Don'ts

### Do:
- **Do** preserve the pinned Fraunces/Nunito Sans pairing.
- **Do** retain 44px minimum button targets, visible keyboard focus, and explicit names for icon controls.
- **Do** pair placement colors with footprint geometry and reason text.
- **Do** honor reduced motion in both CSS transitions and renderer placement/camera motion.

### Don't:
- **Don't** apply the architectural warm-neutral exception to interface panels.
- **Don't** replace the compact floating palette with a permanent large sidebar.
- **Don't** infer hardware FPS or full accessibility conformance from browser automation.

Not canonized or repaired: the more specific .top-actions .save-button background defeats .save-button:hover, so the declared deep-blue hover is not the effective Save hover. The small letter-spaced .brand-product identifier remains specific to the existing brand lockup, not a reusable eyebrow pattern. Compact metadata sizes are recorded for existing controls, not endorsed for general prose. No UI corrections or new visual validation were performed in this documentation-only pass.
