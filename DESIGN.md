---
name: "Barrio Builder"
description: "A Medellín hillside diorama with warm floating game controls."
colors:
  ink: "#423e33"
  secondary: "#716454"
  surface: "#fffaf2f0"
  surface-solid: "#fffaf2"
  page: "#efe6d8"
  accent: "#a24f32"
  accent-deep: "#884029"
  teal: "#28665c"
  hover: "#ebdfce"
  pressed: "#ecdbc7"
  line: "#d8cbbb"
  highlight: "#fffdf8"
  brand-ink: "#3c5147"
  keycap: "#e8dfd2"
  keycap-edge: "#c9baa5"
  scrollbar: "#b7a28a"
  model-rest: "#eee6d8"
  model-hover: "#f6ede0"
  model-selected: "#fbefda"
  model-ring: "#b56546"
  tab-underline: "#b46a49"
  tooltip: "#423e33"
  tooltip-keycap: "#615b4f"
  status: "#325e51"
  feedback-valid: "#226357"
  feedback-danger: "#a04631"
  feedback-danger-surface: "#fff1e8"
  backdrop: "#38332866"
  collection-page: "#f4f7fb"
  collection-secondary: "#53647b"
  world-terracotta: "#b5603f"
  world-burnt-orange: "#c9733a"
  world-coral: "#e0806e"
  world-brick-red: "#9e4a35"
  world-ochre: "#c99a52"
  world-mustard: "#d9ae3f"
  world-cream: "#eadfc4"
  world-off-white: "#f1ede3"
  world-turquoise: "#4fb3bf"
  world-teal: "#5f8f88"
  world-dusty-blue: "#6f8fb5"
  world-muted-green: "#7e9a5a"
  world-concrete: "#a9a398"
  world-brick: "#b8613f"
  world-brick-dark: "#94492f"
  world-mortar: "#cfc6b4"
  world-window-dark: "#2b3236"
  world-metal: "#4a5157"
  world-tank-black: "#24282b"
  world-tank-blue: "#2f5f8f"
  world-wood: "#8a5e3b"
  world-leaf: "#5f8c4a"
  world-leaf-deep: "#3f6b3c"
  world-grass: "#96b47f"
  world-soil: "#a8643f"
  world-stone: "#b9ad99"
  world-asphalt: "#8e8a84"
  world-zinc: "#9aa3a1"
  world-shutter: "#8b958f"
  world-lamp: "#ffe2a8"
  world-ghost: "#fff4e2"
  light-afternoon-sun: "#ffd9a8"
  light-afternoon-zenith: "#a9c6cf"
  light-afternoon-horizon: "#f2dcc0"
  light-daylight-sun: "#fff6ea"
  light-daylight-zenith: "#9fc3dc"
  light-daylight-horizon: "#e9f0ef"
  light-evening-sun: "#ffa66e"
  light-evening-zenith: "#58648f"
  light-evening-horizon: "#f0a982"
typography:
  display:
    fontFamily: "Fraunces, serif"
    fontSize: "27px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.035em"
  display-mobile:
    fontFamily: "Fraunces, serif"
    fontSize: "25px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Fraunces, serif"
    fontSize: "27px"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Fraunces, serif"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  panel-title:
    fontFamily: "Fraunces, serif"
    fontSize: "17px"
    fontWeight: 600
  body:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  dialog-body:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  button:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 700
  menu-item:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "13px"
    fontWeight: 700
  label:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 800
  chip:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "11px"
    fontWeight: 700
  metadata:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "10px"
    fontWeight: 700
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
  tooltip: "9px"
  control: "11px"
  model: "12px"
  warning: "14px"
  toolbar: "16px"
  palette: "18px"
  feedback: "18px"
  dialog: "18px"
  chip: "20px"
  selection: "24px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
components:
  button-ghost:
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface-solid}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px"
  button-save:
    textColor: "{colors.teal}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px"
  toolbar:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.toolbar}"
    padding: "4px"
  count-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    typography: "{typography.chip}"
    rounded: "{rounded.chip}"
    padding: "7px 11px"
  palette:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.palette}"
    padding: "6px 9px 9px"
  model-card:
    backgroundColor: "{colors.model-rest}"
    rounded: "{rounded.model}"
    width: "64px"
    height: "64px"
  selection-strip:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.selection}"
    padding: "0 10px 0 16px"
  tooltip:
    backgroundColor: "{colors.tooltip}"
    textColor: "{colors.surface-solid}"
    rounded: "{rounded.tooltip}"
    padding: "7px 10px"
  status-toast:
    backgroundColor: "{colors.status}"
    textColor: "{colors.surface-solid}"
    rounded: "{rounded.chip}"
  placement-feedback:
    backgroundColor: "{colors.surface-solid}"
    textColor: "{colors.feedback-valid}"
    rounded: "{rounded.feedback}"
  lighting-panel:
    backgroundColor: "{colors.surface-solid}"
    rounded: "{rounded.toolbar}"
    width: "228px"
  dialog:
    backgroundColor: "{colors.surface-solid}"
    rounded: "{rounded.dialog}"
    padding: "28px"
    width: "420px"
---

# Design System: Barrio Builder

## Overview

**Creative North Star: "A neighborhood built one floor at a time"**

The world is a Medellín hillside held as a diorama. Self-built houses climb contour terraces. Street facades are painted. Side and back walls and upper floors stay exposed brick. Concrete slab bands mark every floor. Upper floors cantilever over the street (volados). Roofs carry black or blue water tanks, plants, laundry lines, rebar stubs, and small sheds. Utility poles and sagging cables connect the streets to the houses, and motorcycles park along the streets. Stone retaining walls with concrete coping hold each terrace. The board floats as a slab with soil sides and a fringe of trees, against a sky gradient. Three lighting presets change the mood: warm afternoon, bright daylight, and soft evening with lit windows.

The interface is a set of warm, compact floating controls: a cream translucent surface, terracotta accent, and deep teal for Save and status. Fraunces carries the brand and titles. Nunito Sans carries the controls.

**Key characteristics:**

- Orthographic diorama with a bounded board and a sky gradient.
- Construction honestly shown: brick, concrete, steel, and paint, without grime or decay.
- Warm brick dominates. Cool hues stay low in chroma and appear on painted facades and doors.
- Compact cream controls that can be hidden entirely (`H`).

Sources: `web/src/render/` for the world, `web/src/style.css` and `web/src/ui.ts` for the interface. The research behind the direction is in `docs/visual-reference-analysis.md`.

Conflict to resolve: `PRODUCT.md` says UI surfaces keep the cool Barrio brand neutrals. The shipped interface (commit 3a1fc8c) uses warm cream surfaces and a terracotta accent. This document records the shipped state.

## Colors

### World

All world colors come from `PALETTE` in `web/src/render/palette.ts`. They are sRGB hex values converted to linear through `THREE.Color`. They are stored as vertex colors on one shared material. Rendered appearance depends on the lighting preset and Neutral tone mapping.

- **Painted plaster** (`PLASTER` list): terracotta, turquoise, mustard, coral, dusty blue, ochre, teal, cream, burnt orange, muted green, and off-white. Street facades and ground floors use them. A darker plinth at 72 percent of the wall color runs along the base of painted ground floors.
- **Trim** (`TRIM` list): teal, brick red, dusty blue, mustard, turquoise, and coral. Doors, railings, and window frames on brick walls use them. Frames on painted walls are off-white.
- **Brick** (`world-brick`, `world-brick-dark`, `world-mortar`): exposed walls. On the high quality tier the shader draws running-bond courses 0.1 units tall with mortar joints.
- **Construction** (`world-concrete`, `world-stone`, `world-zinc`, `world-shutter`, `world-metal`): slabs, coping, retaining walls, corrugated roofs, roll-down shutters, grilles, and rails.
- **Landscape** (`world-grass`, `world-leaf`, `world-leaf-deep`, `world-soil`, `world-stone`): terraces, trees, shrubs, and diorama sides.
- **Accents** (`world-tank-black`, `world-tank-blue`, `world-lamp`, `world-window-dark`): water tanks, street lamps, and glass.
- **Preview** (`world-ghost`, `world-off-white`, `world-coral`): a valid ghost is warm off-white at 0.62 opacity. Invalid and remove states are coral. Source: `World.showGhost()` in `web/src/render/world.ts`.

### Light

`web/src/render/lighting.ts` defines three presets. Each sets the sun color, intensity, and direction, the hemisphere sky and ground colors, exposure, a zenith-to-horizon background gradient, and fog tinted to the horizon. Evening also lights a random 62 percent of window cells through an emissive term in `material.ts`. The `light-*` tokens record the sun, zenith, and horizon colors.

### Interface

- **Surfaces**: `surface` (translucent cream, `--surface`) for toolbars, palette, chip, and selection strip. `surface-solid` for menus, help, dialogs, and feedback. `page` is the root background.
- **Text**: `ink` (`--ink`) and `secondary` (`--secondary`). `brand-ink` for the wordmark.
- **Accent**: `accent` (`--accent`) marks pressed tools, the brand mark, primary dialog buttons, and the active lighting preset. `accent-deep` is the primary hover.
- **Teal** (`--teal`): Save icon, focus outline, text selection, and the loading screen. `status` is the toast background. `feedback-valid` is the valid placement note.
- **Danger**: `feedback-danger` on `feedback-danger-surface` for invalid placement notes and the storage warning.
- **Collection page**: `/?contact-sheet` keeps the older cool `collection-page` and `collection-secondary` values.

**The World and Controls Rule.** World colors stay in the world. The interface uses its own warm neutrals and a single terracotta accent. Do not paint controls with facade colors.

## Typography

**Display font:** Fraunces, serif, imported at weight 600. **Body font:** Nunito Sans, sans-serif, at 400, 600, 700, and 800. Both load locally through @fontsource.

- **Display:** the wordmark (`.brand > span`), 27px, 25px at 700px and below. It inherits weight 400 from the root, and only Fraunces 600 is imported, with `font-synthesis: none`. The token records the declared weight.
- **Headline:** dialog titles, 27px/600. **Title:** help panel title, 23px/600. **Panel title:** lighting panel heading, 17px/600.
- **Body:** 14px root. Dialog paragraphs use a 1.6 line height.
- **Controls:** buttons 700. Menu and lighting items 13px. The selection title and help labels are 12px/800. The count chip, tooltips, and the selection description are 11px. Keycaps and some mobile labels are 10px.

## Layout

Source: `web/src/style.css`.

- **Top bar:** inset 20px from the top and 24px from the sides. The wordmark and count chip sit on the left. The action toolbar sits on the right: undo, redo, lighting, hide interface, Save, and menu.
- **View tools:** a vertical toolbar 24px from the right edge, centered vertically. It holds zoom in, zoom out, rotate left, rotate right, and home.
- **Bottom UI:** centered, 440px wide (at most 100% − 24px), 18px from the bottom or the safe-area inset. The selection strip sits above the palette. The palette has icon-only category tabs, tool buttons (explore, remove, rotate), and a row of 64px model cards that scrolls horizontally.
- **At 700px and below:** 12px insets. The wordmark and chip stack. The action toolbar becomes a 3-column grid of 44px buttons. The view-rotate buttons are hidden. Model cards are 52px. The selection strip spans the full width.
- **Hidden interface:** `body.ui-hidden` fades every overlay to opacity 0. A faint show-interface button stays at the top right.
- Buttons keep a minimum target of 44 × 44px.

### Camera

`World` in `web/src/render/world.ts` uses an orthographic camera. It starts at (43, 34, 48), looks at (16, 1.2, 16), and uses zoom 1.2. The frustum spans 27 units on landscape screens and 30 / aspect on portrait screens. Zoom is limited to 0.55 to 6, the polar angle to 0.5 to 1.2 rad, and the pan target to the board plus 2 cells. `Q` and `E` turn the view a quarter turn with easing.

## Elevation and depth

Interface surfaces use soft warm shadows: `--shadow` (`0 6px 24px #53412a1f` plus a 1px inner highlight) for toolbars, chip, strip, and feedback. The palette uses a slightly deeper `0 8px 30px #53412a2b`, and dialogs use `0 16px 64px #3e302f40`.

In the world, depth comes from four sources:

- Sun shadows: a fixed fitted frustum, PCF at 1024px on the low tier and PCF soft at 2048px on the high tier.
- Baked contact darkening at wall bases.
- Corner occlusion on grass at the foot of each terrace.
- Concrete coping that outlines each terrace edge.

Rendering uses sRGB output and Neutral tone mapping. Thumbnails use their own fixed light (hemisphere `#dfe9ef` / `#b49a7a` at 1.7, sun `#ffe2bd` at 3.2) and the same tone mapping (`web/src/render/thumbnails.ts`).

## Shapes

Controls are rounded rectangles: 11px buttons, 12px model cards, 16px toolbars, and 18px palette, feedback, and dialogs. The count chip and the selection strip are pills. Pressed palette tabs show a 2px terracotta underline. Pressed model cards show a 2px terracotta inner ring and lift by 3px.

Buildings are stacked storey volumes 0.68 units tall with 0.07 slab bands, framed openings, and flat roofs with parapets, rails, or bare slabs. The shape grammar is in `web/src/render/architecture.ts`.

## Components

- **Toolbars:** `.top-actions` and `.view-tools` on `surface` with the 16px radius. Undo and redo are separated from the other actions by a `line` divider.
- **Lighting panel:** a 228px popover under the sun button with three preset buttons. The active preset shows a 3px terracotta bar on its left edge.
- **Palette:** category tabs, tool buttons, and model cards with rendered thumbnails. Hovering a card lifts it 2px.
- **Selection strip:** the selected item's name and description, with a rotate button and an `R` keycap.
- **Feedback:** a placement note near the cursor, teal when valid and red-brown on pale peach when invalid. A status toast (`#status`) on deep teal confirms actions. Tooltips are dark ink with cream text and a keycap.
- **Dialog:** native `<dialog>` on `surface-solid`, with a terracotta primary action.

## Motion

- Placement: the structure drops 0.6 units with ease-out cubic, then squashes and settles. The whole motion takes 340 ms. A pooled ring expands and fades over 520 ms on landing.
- Removal shrinks over 170 ms. Edits of more than 4 structures appear at once.
- Zoom and orbit ease toward their targets.
- UI transitions run at 160ms.
- `prefers-reduced-motion` disables renderer easing, CSS transitions, and animations.
- The idle world is still by design. There is no wind, traffic, or day cycle.
- Sound is synthesized foley in `web/src/sound.ts`: a short low tone with a filtered noise click, pitch-jittered. It starts after the first interaction and can be muted from the menu.

## Do's and Don'ts

### Do

- Keep the brick-first rule: painted street fronts, brick sides and upper floors.
- Add new building details through the grammar in `architecture.ts`, so they inherit finish rules and slot placement.
- Add new world colors to `palette.ts` and to this file together.
- Keep 44px targets, visible focus, and names on icon-only controls.

### Don't

- Don't add grime, trash, or decay textures. Unfinished is not derelict.
- Don't use pitched clay-tile roofs, colonial balconies, or national clichés.
- Don't use the world palette on interface surfaces.
- Don't infer hardware frame rates from SwiftShader measurements.

## Environmental rendering

The environment uses Warm Painterly with Neutral tone mapping: golden-green grass, olive foliage, warm Colombian architecture, calm blue-green water, and warm sunlight with cool shadows. Five reusable tree silhouettes and regional palms form seeded clusters. Environmental colors are separate from the brand and UI tokens. See [the art-direction record](docs/environment-art-direction.md) for palettes, fixed-camera comparisons, research, configuration and verification.
