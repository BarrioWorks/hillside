import type { Controller } from './controller';
import type { BuildingDefinition } from './domain';
import { type IconName, icon } from './icons';
import type { AssetState } from './render/assets';
export function element<T extends Element>(selector: string, elementType: { new (...args: never[]): T }): T {
  const result = document.querySelector(selector);
  if (!(result instanceof elementType)) throw new Error(`Missing interface element ${selector}`);
  return result;
}
function button(action: string, label: string, name: IconName, extra = ''): string {
  return `<button type="button" data-action="${action}" title="${label}" aria-label="${label}" ${extra}>${icon(name)}</button>`;
}
function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}
export class UI {
  readonly canvas: HTMLCanvasElement;
  hidden = false;
  private category = 'building';
  constructor(
    readonly controller: Controller,
    private readonly images: Map<string, string>,
    onAction: (action: string) => void,
  ) {
    const app = element('#app', HTMLDivElement);
    app.innerHTML = `<canvas id="world" aria-label="Neighborhood building canvas. Click to place. Drag to orbit. Right drag to pan. Scroll to zoom." tabindex="0"></canvas>
    <header class="topbar"><a class="brand" href="/" aria-label="Barrio Builder home"><svg class="brand-mark" width="35" height="35" viewBox="0 0 36 36" aria-hidden="true"><path fill="#245BEB" d="M3 16h9v17H3zM14 5h9v28h-9zM25 12h8v21h-8z"/><path fill="#fff" d="M6 20h3v3H6zm11-10h3v3h-3zm0 7h3v3h-3zm11 0h2v3h-2zM6 26h3v7H6zm11-2h3v9h-3zm11 1h2v8h-2z"/></svg><span>barrio<span class="brand-product">builder</span></span></a><div class="neighborhood-name"><span class="sun">${icon('sun')}</span><span>A little place of your own<span id="neighborhood-count">Your hillside is waiting</span></span></div><div class="top-actions"><div class="history">${button('undo', 'Undo (Ctrl Z)', 'undo', 'disabled')}${button('redo', 'Redo (Ctrl Shift Z)', 'redo', 'disabled')}</div>${button('sound', 'Mute sound', 'sound')}${button('help', 'How to play', 'help')}<button class="save-button" data-action="save" aria-label="Save">${icon('save')}<span>Save</span></button><div class="menu-wrap"><button data-action="menu" aria-label="Neighborhood menu" title="Neighborhood menu" aria-expanded="false">${icon('more')}</button><div id="file-menu" class="file-menu" hidden><p>Your neighborhood</p><button data-action="load">${icon('save')}Load saved neighborhood</button><button data-action="export">${icon('download')}Export a copy</button><button data-action="import">${icon('upload')}Import a neighborhood</button><button data-action="help">${icon('help')}How to play</button><button data-action="sound" class="menu-sound">${icon('sound')}Mute sound</button><hr/><button data-action="new">${icon('plus')}New neighborhood</button><a href="?contact-sheet" target="_blank">Explore the collection${icon('home')}</a><small>Private by nature. Saved on this device.</small></div></div></div></header>
    <div class="view-tools" aria-label="Camera controls">${button('zoom-in', 'Zoom in', 'plus')}${button('zoom-out', 'Zoom out', 'minus')}${button('home', 'Reset camera', 'home')}</div>
    <aside class="help-panel" id="help-panel" hidden><div><h2>A neighborhood starts with you.</h2>${button('help', 'Close help', 'close')}</div><p>Pick a little building, then click an open terrace to give it a home.</p><dl><dt>Make connections</dt><dd>Lay paths on level ground. Rotate stairs toward the next terrace.</dd><dt>Look around</dt><dd>Drag to orbit. Right-drag to pan. Scroll to zoom. On touch, use two fingers to pan and pinch.</dd><dt>Make it yours</dt><dd>Press <kbd>R</kbd> to rotate, <kbd>X</kbd> to remove, <kbd>Esc</kbd> to explore. Undo is always a click away.</dd></dl><p class="help-note">No rush. No score. Just a place to grow.</p><small id="asset-credit">Loading community landmark…</small></aside>
    <div class="scene-caption"><span class="caption-line"></span><span>Somewhere on a sunny hillside.<small>Inspired by the neighborhoods of Medellín.</small></span></div>
    <div class="bottom-ui"><div class="selection-line"><span id="selection-title">Casa</span><span class="selection-divider"></span><span id="selection-description">A place to begin.</span><button data-action="rotate" title="Rotate building (R)" aria-label="Rotate building (R)">${icon('rotate')}<kbd>R</kbd></button></div><section class="palette" aria-label="Building palette"><div class="palette-tabs" role="tablist" aria-label="Palette categories"><button role="tab" data-category="building" aria-selected="true">${icon('home')}Homes</button><button role="tab" data-category="connections" aria-selected="false">${icon('path')}Connections</button><button role="tab" data-category="prop" aria-selected="false">${icon('tree')}Green & gathering</button><div class="palette-tools">${button('navigate', 'Explore without building (Esc)', 'hand')}${button('remove', 'Remove a structure (X)', 'trash')}</div></div><div id="palette-items" class="palette-items"></div></section><div class="bottom-hints"><span><span class="hint-dot"></span><span id="status" role="status" aria-live="polite">A little hillside. Make it yours.</span></span><span class="desktop-hint">Click to build<span>·</span>Drag to orbit<span>·</span>Scroll to zoom</span></div></div>
    <div id="placement-feedback" class="placement-feedback" hidden></div><div id="storage-warning" class="storage-warning" role="status" hidden></div><input id="import-file" type="file" accept="application/json,.json" hidden/>
    <dialog id="new-dialog"><form method="dialog"><h2>A fresh patch of hillside?</h2><p>Starting fresh replaces this neighborhood’s autosave. Export a copy first if you’d like to keep it.</p><div><button value="cancel">Keep building</button><button value="new" class="primary">Start fresh</button></div></form></dialog>`;
    this.canvas = element('#world', HTMLCanvasElement);
    this.renderPalette();
    app.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest('button');
      if (!(target instanceof HTMLButtonElement)) return;
      const category = target.dataset.category;
      if (category) {
        this.category = category;
        this.renderPalette();
        return;
      }
      const kind = target.dataset.kind;
      if (kind) {
        controller.select({ type: 'place', kind });
        return;
      }
      const action = target.dataset.action;
      if (action) onAction(action);
    });
    document.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Element && !event.target.closest('.menu-wrap')) this.closeMenu();
    });
    controller.subscribe(() => this.update());
    this.update();
  }
  private definitions(): BuildingDefinition[] {
    return this.controller.catalog.filter((def) =>
      this.category === 'connections'
        ? def.category === 'path' || def.category === 'stairs'
        : def.category === this.category,
    );
  }
  private renderPalette(): void {
    const items = element('#palette-items', HTMLDivElement);
    items.replaceChildren();
    for (const def of this.definitions()) {
      const button = document.createElement('button');
      button.className = 'model-button';
      button.type = 'button';
      button.dataset.kind = def.id;
      button.title = def.description;
      button.setAttribute('aria-label', `Build ${def.name}`);
      button.setAttribute('aria-pressed', 'false');
      const image = document.createElement('img');
      image.src = this.images.get(def.id) ?? '';
      image.width = 128;
      image.height = 128;
      image.alt = '';
      image.draggable = false;
      const label = document.createElement('span');
      label.textContent = def.name;
      const size = document.createElement('small');
      size.textContent = `${def.width} × ${def.depth}`;
      button.append(image, label, size);
      items.append(button);
    }
    document.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.category === this.category));
    });
    this.update();
  }
  update(): void {
    const state = this.controller;
    const current =
      state.tool.type === 'place'
        ? state.catalog.find((def) => def.id === (state.tool.type === 'place' ? state.tool.kind : ''))
        : null;
    element('#selection-title', HTMLSpanElement).textContent =
      current?.name ?? (state.tool.type === 'remove' ? 'Make some room' : 'Take a look around');
    element('#selection-description', HTMLSpanElement).textContent =
      current?.description ??
      (state.tool.type === 'remove'
        ? 'Click a structure to remove it.'
        : 'Drag, pan, and find a new perspective.');
    element('#status', HTMLSpanElement).textContent = state.message;
    element('#neighborhood-count', HTMLSpanElement).textContent =
      `${state.snapshot.structures.filter((s) => state.catalog.find((def) => def.id === s.kind)?.category === 'building').length} homes · ${state.snapshot.connected} connected`;
    document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((button) => {
      button.setAttribute(
        'aria-pressed',
        String(state.tool.type === 'place' && state.tool.kind === button.dataset.kind),
      );
    });
    for (const [action, enabled] of [
      ['undo', state.snapshot.canUndo],
      ['redo', state.snapshot.canRedo],
    ] satisfies [string, boolean][]) {
      const button = document.querySelector(`[data-action="${action}"]`);
      if (button instanceof HTMLButtonElement) button.disabled = !enabled;
    }
    for (const [action, type] of [
      ['remove', 'remove'],
      ['navigate', 'navigate'],
    ]) {
      document
        .querySelector(`[data-action="${action}"]`)
        ?.setAttribute('aria-pressed', String(state.tool.type === type));
    }
    const feedback = element('#placement-feedback', HTMLDivElement);
    feedback.hidden = !state.hover || state.tool.type === 'navigate';
    feedback.classList.toggle('invalid', state.tool.type === 'remove' || state.preview?.valid === false);
    feedback.innerHTML =
      state.tool.type === 'remove'
        ? `${icon('trash')}Click to remove`
        : state.preview
          ? `${icon(state.preview.valid ? 'check' : 'close')}${escapeHtml(state.preview.valid ? 'Ready to build' : state.preview.reason)}`
          : '';
    const warning = element('#storage-warning', HTMLDivElement);
    warning.textContent = state.persistenceWarning;
    warning.hidden = !state.persistenceWarning;
  }
  feedbackPosition(x: number, y: number): void {
    const feedback = element('#placement-feedback', HTMLDivElement);
    feedback.style.left = `${Math.min(innerWidth - 260, Math.max(12, x + 18))}px`;
    feedback.style.top = `${Math.max(85, Math.min(innerHeight - 260, y - 44))}px`;
  }
  toggleHelp(): void {
    const panel = element('#help-panel', HTMLElement);
    panel.hidden = !panel.hidden;
  }
  toggleMenu(): void {
    const menu = element('#file-menu', HTMLDivElement);
    menu.hidden = !menu.hidden;
    document.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded', String(!menu.hidden));
  }
  closeMenu(): void {
    element('#file-menu', HTMLDivElement).hidden = true;
    document.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded', 'false');
  }
  sound(muted: boolean): void {
    document.querySelectorAll<HTMLButtonElement>('[data-action="sound"]').forEach((button) => {
      const label = muted ? 'Unmute sound' : 'Mute sound';
      button.innerHTML =
        icon(muted ? 'muted' : 'sound') + (button.classList.contains('menu-sound') ? label : '');
      button.setAttribute('aria-label', label);
      button.title = label;
      button.setAttribute('aria-pressed', String(muted));
    });
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    document.body.classList.toggle('ui-hidden', hidden);
  }
  lighting(preset: string): void {
    document.documentElement.dataset.light = preset;
  }
  asset(state: AssetState): void {
    const credit = element('#asset-credit', HTMLElement);
    credit.textContent =
      state.status === 'ready'
        ? `Community landmark by ${state.source}`
        : state.status === 'error'
          ? 'The community landmark could not load. You can keep building.'
          : 'Loading community landmark…';
  }
}
