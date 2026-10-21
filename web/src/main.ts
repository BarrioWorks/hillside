import './style.css';
import { Controller } from './controller';
import { createCore } from './core';
import type { Command, Snapshot } from './domain';
import { PointerGesture } from './input';
import { downloadSave, Persistence } from './persistence';
import { ModelLibrary } from './render/models';
import { showContactSheet, thumbnails } from './render/thumbnails';
import { type LightingPreset, World } from './render/world';
import { Sound } from './sound';
import { element, UI } from './ui';

interface BarrioDebug {
  snapshot(): Snapshot;
  cellToScreen(x: number, z: number, elevation?: number): { x: number; y: number };
  metrics(): object;
  command(command: Command): boolean;
  benchmark(): { milliseconds: number; structures: number };
  preview(kind: string, x: number, z: number, rotation?: number): unknown;
  renderContinuously(enabled: boolean): void;
  view(view: { zoom?: number; azimuth?: number; polar?: number; target?: [number, number, number] }): void;
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
  const seed = 2026;
  const core = await createCore(seed);
  const library = new ModelLibrary(core.catalog());
  if (params.has('contact-sheet')) {
    showContactSheet(library, core.catalog());
    return;
  }
  const storage = params.has('benchmark') ? sessionStorage : localStorage;
  const controller = new Controller(core, new Persistence(storage));
  const sound = new Sound();
  let world: World;
  const ui = new UI(controller, thumbnails(library, controller.catalog), (action) => {
    switch (action) {
      case 'undo':
        controller.execute({ type: 'undo' });
        break;
      case 'redo':
        controller.execute({ type: 'redo' });
        break;
      case 'rotate':
        controller.rotate();
        break;
      case 'remove':
        controller.select({ type: 'remove' });
        break;
      case 'navigate':
        controller.select({ type: 'navigate' });
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
  world = new World(ui.canvas, controller.snapshot, library);
  ui.lighting(world.lighting);
  let renderedSnapshot = controller.snapshot;
  controller.subscribe(() => {
    if (renderedSnapshot !== controller.snapshot) {
      world.reconcile(controller.snapshot);
      renderedSnapshot = controller.snapshot;
    }
    world.showGhost(controller.tool, controller.hover, controller.preview, controller.rotation);
  });
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
      controller.point(world.pick(event.clientX, event.clientY));
      const changed = controller.place();
      sound.play(changed);
    }
  });
  ui.canvas.addEventListener('pointercancel', (event) => gestures.cancel(event.pointerId));
  ui.canvas.addEventListener('pointerleave', () => controller.point(null));
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
      controller.execute({ type: 'reset', seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 2026 });
      world.home();
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
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      controller.execute({ type: event.shiftKey ? 'redo' : 'undo' });
    } else if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      controller.save();
    } else if (!event.ctrlKey && !event.metaKey) {
      if (key === 'r') controller.rotate();
      if (key === 'x') controller.select({ type: 'remove' });
      if (key === 'escape') {
        controller.select({ type: 'navigate' });
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
    cellToScreen: (x, z, elevation) => world.screenCell(x, z, elevation),
    metrics: () => ({
      ...world.metrics(),
      coreMilliseconds: controller.coreMilliseconds,
      revision: controller.snapshot.revision,
    }),
    command: (command) => controller.execute(command),
    preview: (kind, x, z, rotation = 0) => core.preview(kind, x, z, rotation),
    renderContinuously: (enabled) => {
      world.continuousRendering = enabled;
      world.frameMilliseconds = [];
    },
    updateShadows: () => world.invalidateShadows(),
    view: (view) => world.setView(view),
    benchmark: () => {
      world.continuousRendering = true;
      world.frameMilliseconds = [];
      const start = performance.now();
      controller.execute({ type: 'benchmark' });
      return { milliseconds: performance.now() - start, structures: controller.snapshot.structures.length };
    },
  };
  if (params.has('benchmark')) window.__barrio.benchmark();
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
