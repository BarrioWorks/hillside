import './style.css';
import { Controller } from './controller';
import { createCore } from './core';
import type { Command, Preview, Snapshot } from './domain';
import { PointerGesture } from './input';
import { downloadSave, Persistence } from './persistence';
import { center, LEVEL } from './render/hex';
import { type LightingPreset, World } from './render/world';
import { Sound } from './sound';
import { element, UI } from './ui';

interface BarrioDebug {
  snapshot(): Snapshot;
  hexToScreen(q: number, r: number, elevation?: number): { x: number; y: number };
  metrics(): object;
  command(command: Command): boolean;
  autoplay(count: number): { milliseconds: number; tiles: number };
  preview(q: number, r: number, rotation?: number): Preview;
  rotation(): number;
  renderContinuously(enabled: boolean): void;
  view(view: { zoom?: number; azimuth?: number; polar?: number; target?: [number, number, number] }): void;
  home(): void;
  /** Centers the view on a hex at the given zoom, for documentation captures. */
  focus(q: number, r: number, zoom?: number): void;
  /** Points at a hex and turns the tile in hand, as a player would, to show the preview. */
  hover(q: number, r: number, rotation: number): void;
  light(preset: LightingPreset): void;
  updateShadows(): void;
  readonly ready: boolean;
}
declare global {
  interface Window {
    __barrio: BarrioDebug;
  }
}
async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const requestedSeed = params.has('seed') ? Number(params.get('seed')) : Number.NaN;
  // Seeds are u32 in the core. Without a requested seed every first run differs; an autosave, if any,
  // replaces this run below. Fresh seeds stay under a million so they are easy to read and share.
  const freshSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 2026) % 1_000_000;
  const seed =
    Number.isInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed < 2 ** 32
      ? requestedSeed
      : freshSeed();
  const core = await createCore(seed);
  const storage = params.has('benchmark') || params.has('seed') ? sessionStorage : localStorage;
  const controller = new Controller(core, new Persistence(storage));
  const sound = new Sound();
  let world: World;
  const ui = new UI(controller, (action) => {
    switch (action) {
      case 'skip':
        if (controller.skip()) sound.play('place');
        break;
      case 'new-run':
        newGame(freshSeed());
        break;
      case 'replay':
        newGame(controller.snapshot.seed);
        break;
      case 'view':
        ui.hideResults();
        world.home();
        break;
      case 'results':
        ui.showResults();
        break;
      case 'continue':
        ui.hideVictory();
        break;
      case 'finish':
        ui.hideVictory();
        controller.execute({ type: 'finish' });
        break;
      case 'share':
        void shareScreenshot();
        break;
      case 'rotate-tile':
        controller.rotate(1);
        break;
      case 'rotate-tile-back':
        controller.rotate(-1);
        break;
      case 'save':
        controller.save();
        break;
      case 'load':
        controller.loadSaved();
        ui.closeMenu();
        break;
      case 'export':
        downloadSave(core.save());
        controller.notify('A copy of your neighborhood is ready to keep.');
        ui.closeMenu();
        break;
      case 'export-legacy': {
        const legacy = controller.legacySave();
        if (legacy) {
          downloadSave(legacy, 'my-square-barrio.json');
          controller.notify('Your square neighborhood is ready to keep. It opens in Barrio Builder 0.1.');
        }
        ui.closeMenu();
        break;
      }
      case 'import':
        element('#import-file', HTMLInputElement).click();
        ui.closeMenu();
        break;
      case 'new':
        element('#new-dialog', HTMLDialogElement).showModal();
        ui.closeMenu();
        break;
      case 'menu':
        ui.toggleMenu();
        break;
      case 'help':
        ui.toggleHelp();
        break;
      case 'sound':
        sound.muted = !sound.muted;
        ui.sound(sound.muted);
        if (!sound.muted) sound.play();
        break;
      case 'zoom-in':
        world.zoom(1.2);
        break;
      case 'zoom-out':
        world.zoom(1 / 1.2);
        break;
      case 'home':
        world.home();
        break;
      case 'hide-ui':
        ui.setHidden(!ui.hidden);
        break;
      case 'rotate-left':
        world.rotateView(-1);
        break;
      case 'rotate-right':
        world.rotateView(1);
        break;
      case 'light:afternoon':
      case 'light:daylight':
      case 'light:evening': {
        const preset = action.slice('light:'.length) as LightingPreset;
        world.setLighting(preset);
        ui.lighting(preset);
        break;
      }
    }
  });
  world = new World(ui.canvas, controller.snapshot);
  /** Shares the finished neighborhood as an image, or downloads it where sharing files is unavailable. */
  const shareScreenshot = async () => {
    const { regionName, seed, score } = controller.snapshot;
    const blob = await world.capture();
    if (!blob) {
      controller.notify('The screenshot could not be made in this browser.');
      return;
    }
    const name = `barrio-${regionName
      .normalize('NFD')
      .replace(/[^A-Za-z]/g, '')
      .toLowerCase()}-${seed}-${score}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Barrio · ${regionName}`, text: `${score} points` });
        return;
      } catch (error) {
        // A cancelled share sheet means no; anything else falls back to a download below.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    controller.notify('Screenshot saved.');
  };
  const newGame = (seed: number) => {
    controller.rotation = 0;
    controller.execute({ type: 'newGame', seed });
    world.home();
  };
  ui.lighting(world.lighting);
  world.controls.addEventListener('change', () => ui.viewAzimuth(world.azimuth()));
  ui.viewAzimuth(world.azimuth());
  let renderedSnapshot = controller.snapshot;
  // Touch has no hover: the first tap previews a spot, a second tap on the same spot places the tile.
  // Any change to the board or the tile's rotation asks for a fresh preview tap.
  let armed: { q: number; r: number } | null = null;
  let armedRotation = controller.rotation;
  const sync = () => {
    if (renderedSnapshot !== controller.snapshot || armedRotation !== controller.rotation) armed = null;
    armedRotation = controller.rotation;
    if (renderedSnapshot !== controller.snapshot) {
      const count = controller.snapshot.tiles.length;
      const before = renderedSnapshot.tiles.length;
      // Keep the early neighborhood framed as it grows; later the player steers the camera.
      const grew = count > before + 4 || count < before || (count <= 10 && count !== before);
      const fresh = controller.snapshot.seed !== renderedSnapshot.seed;
      world.reconcile(controller.snapshot);
      renderedSnapshot = controller.snapshot;
      if (grew || fresh) world.home();
    }
    world.showGhost(controller.hover, controller.preview, controller.snapshot.current, controller.rotation);
    const hover = controller.hover;
    if (hover) {
      const middle = world.hexToScreen(hover.q, hover.r);
      const side = world.hexToScreen(hover.q + 1, hover.r);
      // Measured to the neighbor's center at the same height, so the radius follows zoom and view angle.
      ui.anchorFeedback(middle.x, middle.y, Math.hypot(side.x - middle.x, side.y - middle.y) / 1.7);
    }
  };
  /**
   * Keyboard placement: arrow keys move between open spots in the pressed direction on screen, Enter or
   * Space places the tile there. Starts from the open spot nearest the middle of the screen.
   */
  const stepSpot = (dx: number, dy: number) => {
    if (controller.snapshot.finished) return;
    const spots = controller.snapshot.frontier.map((spot) => ({
      spot,
      at: world.hexToScreen(spot.q, spot.r),
    }));
    if (!spots.length) return;
    const from = controller.hover ? world.hexToScreen(controller.hover.q, controller.hover.r) : null;
    let chosen = spots[0];
    if (!from) {
      const middle = { x: innerWidth / 2, y: innerHeight / 2 };
      chosen = spots.reduce((a, b) =>
        Math.hypot(a.at.x - middle.x, a.at.y - middle.y) <= Math.hypot(b.at.x - middle.x, b.at.y - middle.y)
          ? a
          : b,
      );
    } else {
      let best = Number.POSITIVE_INFINITY;
      for (const candidate of spots) {
        const vx = candidate.at.x - from.x,
          vy = candidate.at.y - from.y;
        const distance = Math.hypot(vx, vy);
        const along = (vx * dx + vy * dy) / (distance || 1);
        if (distance < 1 || along < 0.35) continue;
        const cost = distance * (2 - along);
        if (cost < best) {
          best = cost;
          chosen = candidate;
        }
      }
      if (best === Number.POSITIVE_INFINITY) return;
    }
    if (chosen) controller.point({ q: chosen.spot.q, r: chosen.spot.r });
  };
  controller.subscribe(sync);
  /** Places the tile at the hovered spot, then lets the points, quests and milestones rise from it. */
  const placeHere = () => {
    if (!controller.preview) return;
    const perfect = controller.preview.valid && controller.preview.perfect;
    const changed = controller.place();
    const last = controller.snapshot.last;
    sound.play(!changed ? 'refuse' : perfect || last?.completed.length ? 'perfect' : 'place');
    if (!changed || !last) return;
    const point = world.hexToScreen(last.q, last.r, 1.2);
    const points = last.label ? `+${last.points.total} · ${last.label}` : `+${last.points.total}`;
    ui.floatScore(points, point.x, point.y, last.points.perfect);
    last.completed.forEach((done, index) => {
      window.setTimeout(
        () =>
          ui.floatScore(
            `Quest complete · +${done.quest.points} · +${done.tilesAdded} tiles`,
            point.x,
            point.y + 48 * (index + 1),
            true,
          ),
        450 * (index + 1),
      );
    });
    // Later lines start lower, so they rise beside the first instead of on top of it.
    const after = last.completed.length + 1;
    if (last.milestone && !last.victory)
      window.setTimeout(
        () => ui.floatScore(`${last.milestone} reached`, point.x, point.y + 48 * after, true),
        450 * after,
      );
  };
  const gestures = new PointerGesture();
  ui.canvas.addEventListener('pointerdown', (event) => {
    gestures.down(event.pointerId, event.clientX, event.clientY);
    ui.feedbackPosition(event.clientX, event.clientY);
    controller.point(world.pick(event.clientX, event.clientY));
    ui.canvas.focus({ preventScroll: true });
  });
  ui.canvas.addEventListener('pointermove', (event) => {
    gestures.move(event.pointerId, event.clientX, event.clientY);
    controller.point(world.pick(event.clientX, event.clientY));
    ui.feedbackPosition(event.clientX, event.clientY);
  });
  ui.canvas.addEventListener('pointerup', (event) => {
    const click = gestures.up(event.pointerId);
    if (click && event.button === 0) {
      const hex = world.pick(event.clientX, event.clientY);
      controller.point(hex);
      if (!controller.preview || !hex) return;
      if (event.pointerType !== 'mouse' && (armed?.q !== hex.q || armed?.r !== hex.r)) {
        armed = hex;
        return;
      }
      armed = null;
      placeHere();
    }
  });
  ui.canvas.addEventListener('pointercancel', (event) => gestures.cancel(event.pointerId));
  ui.canvas.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') controller.point(null);
  });
  ui.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  element('#import-file', HTMLInputElement).addEventListener('change', async (event) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    const file = target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) {
      controller.notify('This file is too large. Choose a Barrio JSON file under 5 MB.');
      return;
    }
    try {
      controller.load(await file.text());
    } catch {
      controller.notify('The file could not be read. Please choose it again.');
    }
    target.value = '';
  });
  element('#new-dialog', HTMLDialogElement).addEventListener('close', (event) => {
    const dialog = event.currentTarget;
    if (dialog instanceof HTMLDialogElement && dialog.returnValue === 'new') {
      newGame(freshSeed());
    }
  });
  window.addEventListener('keydown', (event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      element('#new-dialog', HTMLDialogElement).open
    )
      return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      controller.save();
    } else if (!event.ctrlKey && !event.metaKey) {
      // While the victory or results panel is open, only its own buttons act.
      if (ui.overlayOpen) {
        if (key === 'escape') ui.hideVictory();
        return;
      }
      if (key === 'r') controller.rotate(event.shiftKey ? -1 : 1);
      const arrows: Record<string, [number, number]> = {
        arrowleft: [-1, 0],
        arrowright: [1, 0],
        arrowup: [0, -1],
        arrowdown: [0, 1],
      };
      const arrow = arrows[key];
      if (arrow && document.activeElement === ui.canvas) {
        event.preventDefault();
        stepSpot(...arrow);
      }
      if ((key === 'enter' || key === ' ') && document.activeElement === ui.canvas && controller.preview) {
        event.preventDefault();
        placeHere();
      }
      if (key === 's' && controller.skip()) sound.play('place');
      if (key === 'escape') {
        controller.point(null);
        ui.closeMenu();
      }
      if (key === '?') ui.toggleHelp();
      if (key === 'h') ui.setHidden(!ui.hidden);
      if (key === 'q') world.rotateView(-1);
      if (key === 'e') world.rotateView(1);
    }
  });
  window.__barrio = {
    ready: true,
    snapshot: () => controller.snapshot,
    hexToScreen: (q, r, elevation) => world.hexToScreen(q, r, elevation),
    metrics: () => ({
      ...world.metrics(),
      coreMilliseconds: controller.coreMilliseconds,
      revision: controller.snapshot.revision,
    }),
    command: (command) => controller.execute(command),
    preview: (q, r, rotation = 0) => core.preview(q, r, rotation),
    rotation: () => controller.rotation,
    renderContinuously: (enabled) => {
      world.continuousRendering = enabled;
      world.frameMilliseconds = [];
      world.renderMilliseconds = [];
    },
    updateShadows: () => world.invalidateShadows(),
    view: (view) => world.setView(view),
    home: () => world.home(true),
    focus: (q, r, zoom = 2.6) => {
      const cell = [...controller.snapshot.tiles, ...controller.snapshot.frontier].find(
        (spot) => spot.q === q && spot.r === r,
      );
      const c = center(q, r);
      world.setView({ target: [c.x, (cell?.elevation ?? 0) * LEVEL, c.z], zoom });
    },
    hover: (q, r, rotation) => {
      controller.rotation = ((rotation % 6) + 6) % 6;
      controller.point(null);
      controller.point({ q, r });
      const point = world.hexToScreen(q, r);
      ui.feedbackPosition(point.x, point.y);
    },
    light: (preset) => {
      world.setLighting(preset);
      ui.lighting(preset);
    },
    autoplay: (count) => {
      const start = performance.now();
      controller.execute({ type: 'autoplay', count });
      return { milliseconds: performance.now() - start, tiles: controller.snapshot.tiles.length };
    },
  };
  if (params.has('profile')) (window as unknown as { __world: World }).__world = world;
  const growth = Number(params.get('autoplay'));
  if (Number.isInteger(growth) && growth > 0) window.__barrio.autoplay(Math.min(growth, 400));
  window.addEventListener('pagehide', () => world.dispose(), { once: true });
}
void start().catch((error) => {
  const app = document.querySelector('#app');
  if (!app) return;
  app.replaceChildren();
  const wrapper = document.createElement('div');
  wrapper.className = 'loading';
  const mark = document.createElement('span');
  mark.className = 'loading-mark';
  mark.textContent = 'b.';
  const title = document.createElement('p');
  title.textContent = 'The hillside could not open.';
  const detail = document.createElement('p');
  detail.className = 'error-detail';
  detail.textContent = error instanceof Error ? error.message : 'Please reload to try again.';
  const retry = document.createElement('button');
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => location.reload());
  wrapper.append(mark, title, detail, retry);
  app.append(wrapper);
});
