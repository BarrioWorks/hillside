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
  const shortcut = label.match(/ \(([^)]+)\)$/)?.[1];
  const tip = shortcut ? label.slice(0, label.lastIndexOf(' (')) : label;
  return `<button type="button" data-action="${action}" title="${label}" aria-label="${label}" ${extra}>${icon(name)}<span class="tooltip" aria-hidden="true">${tip}${shortcut ? `<kbd>${shortcut}</kbd>` : ''}</span></button>`;
}
function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}
export class UI {
  readonly canvas: HTMLCanvasElement;
  hidden = false;
  private category = 'building';
  private lastMessage = '';
  private toastTimer = 0;
  private previousCount = 0;
  constructor(
    readonly controller: Controller,
    private readonly images: Map<string, string>,
    onAction: (action: string) => void,
  ) {
    const app = element('#app', HTMLDivElement);
    app.innerHTML = `<canvas id="world" aria-label="Neighborhood building canvas. Click to place. Drag to orbit. Right drag to pan. Scroll to zoom." tabindex="0"></canvas>
    <header class="topbar"><div class="identity"><a class="brand" href="/" aria-label="Barrio Builder home"><svg class="brand-mark" width="26" height="26" viewBox="0 0 36 36" aria-hidden="true"><path fill="currentColor" d="M3 16h9v17H3zM14 5h9v28h-9zM25 12h8v21h-8z"/><path fill="#fffaf2" d="M6 20h3v3H6zm11-10h3v3h-3zm0 7h3v3h-3zm11 0h2v3h-2zM6 26h3v7H6zm11-2h3v9h-3zm11 1h2v8h-2z"/></svg><span>barrio</span></a><span id="neighborhood-count" class="count-chip">Your hillside is waiting</span></div>
    <div class="top-actions"><div class="history">${button('undo', 'Undo (Ctrl Z)', 'undo', 'disabled')}${button('redo', 'Redo (Ctrl Shift Z)', 'redo', 'disabled')}</div><div class="lighting-wrap">${button('lighting', 'Change lighting', 'sun', 'aria-expanded="false" aria-controls="lighting-panel"')}<div id="lighting-panel" class="lighting-panel" hidden><h2>A little change of light</h2>${button('light:afternoon', 'Warm afternoon', 'sunset', 'aria-pressed="true"')}${button('light:daylight', 'Bright daylight', 'sun', 'aria-pressed="false"')}${button('light:evening', 'Soft evening', 'moon', 'aria-pressed="false"')}</div></div>${button('hide-ui', 'Hide interface (H)', 'eye-off')}${button('save', 'Save', 'save', 'class="save-button"')}<div class="menu-wrap">${button('menu', 'Neighborhood menu', 'more', 'aria-expanded="false" aria-controls="file-menu"')}<div id="file-menu" class="file-menu" hidden><h2>Your neighborhood</h2><button data-action="load">${icon('save')}Load saved neighborhood</button><button data-action="export">${icon('download')}Export a copy</button><button data-action="import">${icon('upload')}Import a neighborhood</button><button data-action="help">${icon('help')}How to play</button><button data-action="sound" class="menu-sound">${icon('sound')}Mute sound</button><hr/><button data-action="new">${icon('plus')}New neighborhood</button><a href="?contact-sheet" target="_blank" rel="noopener">Explore the collection${icon('home')}</a><small>Private by nature. Saved on this device.</small></div></div></div></header>
    ${button('hide-ui', 'Show interface (H)', 'eye', 'class="show-interface" inert')}
    <div class="view-tools" role="group" aria-label="Camera controls">${button('zoom-in', 'Zoom in', 'plus')}${button('zoom-out', 'Zoom out', 'minus')}<span class="tool-divider"></span>${button('rotate-left', 'Rotate view left (Q)', 'rotate-left')}${button('rotate-right', 'Rotate view right (E)', 'rotate-right')}${button('home', 'Reset camera', 'home')}</div>
    <aside class="help-panel" id="help-panel" aria-label="How to play" hidden><div><h2>A little place of your own.</h2>${button('help', 'Close help', 'close')}</div><p>Choose a piece. Find a terrace. Make yourself at home.</p><dl><dt>Build & explore</dt><dd>Click to build · Drag to orbit · Scroll to zoom. Right-drag to pan. On touch, pan with two fingers and pinch to zoom.</dd><dt>Connect the hillside</dt><dd>Lay paths on level ground. Rotate stairs toward the next terrace.</dd><dt>A few handy keys</dt><dd><kbd>R</kbd> Rotate · <kbd>X</kbd> Remove · <kbd>Esc</kbd> Explore<br/><kbd>Q</kbd> <kbd>E</kbd> Turn the view · <kbd>H</kbd> Hide interface<br/><kbd>Ctrl Z</kbd> Undo · <kbd>Ctrl S</kbd> Save</dd></dl><p class="help-note">No rush. No score. Just a place to grow.</p><small id="asset-credit">Loading community landmark…</small></aside>
    <div class="bottom-ui"><div class="toast-region"><span id="status" role="status" aria-live="polite" aria-atomic="true"></span></div><p class="first-hint" id="first-hint">Click to build · Drag to orbit · Scroll to zoom</p><div class="selection-line"><span id="selection-title">Casa</span><span id="selection-description">A place to begin.</span>${button('rotate', 'Rotate building (R)', 'rotate', 'class="context-rotate"')}<kbd aria-hidden="true">R</kbd></div><section class="palette" aria-label="Building palette"><div class="dock-controls"><div class="palette-tabs" role="tablist" aria-label="Palette categories"><button type="button" role="tab" data-category="building" aria-label="Homes" title="Homes" aria-selected="true">${icon('home')}<span class="tooltip" aria-hidden="true">Homes</span></button><button type="button" role="tab" data-category="connections" aria-label="Connections" title="Connections" aria-selected="false">${icon('path')}<span class="tooltip" aria-hidden="true">Connections</span></button><button type="button" role="tab" data-category="prop" aria-label="Green & gathering" title="Green & gathering" aria-selected="false">${icon('tree')}<span class="tooltip" aria-hidden="true">Green & gathering</span></button></div><div class="palette-tools" role="group" aria-label="Building tools">${button('navigate', 'Explore without building (Esc)', 'hand')}${button('remove', 'Remove a structure (X)', 'trash')}${button('rotate', 'Rotate building (R)', 'rotate')}</div></div><div id="palette-items" class="palette-items"></div></section></div>
    <div id="placement-feedback" class="placement-feedback" hidden></div><div id="storage-warning" class="storage-warning" role="status" hidden></div><input id="import-file" type="file" accept="application/json,.json" hidden/>
    <dialog id="new-dialog"><form method="dialog"><h2>A fresh patch of hillside?</h2><p>Starting fresh replaces this neighborhood’s autosave. Export a copy first if you’d like to keep it.</p><div><button value="cancel">Keep building</button><button value="new" class="primary">Start fresh</button></div></form></dialog>`;
    this.canvas = element('#world', HTMLCanvasElement);
    this.previousCount = controller.snapshot.structures.length;
    this.renderPalette();
    window.setTimeout(() => this.dismissHint(), 8000);
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
      if (action === 'lighting') {
        const open = element('#lighting-panel', HTMLDivElement).hidden;
        this.closeMenu();
        element('#help-panel', HTMLElement).hidden = true;
        this.setLightingOpen(open);
      } else if (action) {
        if (action === 'new') element('#new-dialog', HTMLDialogElement).returnValue = '';
        if (action === 'save') this.lastMessage = '';
        onAction(action);
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('.menu-wrap, .lighting-wrap')) this.closeMenu();
      if (!event.target.closest('.lighting-wrap')) this.setLightingOpen(false);
      if (!event.target.closest('#help-panel, [data-action="help"]'))
        element('#help-panel', HTMLElement).hidden = true;
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.setLightingOpen(false);
        element('#help-panel', HTMLElement).hidden = true;
      }
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
      button.title = `${def.name} · ${def.description}`;
      button.setAttribute('aria-label', `Build ${def.name}`);
      button.setAttribute('aria-pressed', 'false');
      const image = document.createElement('img');
      image.src = this.images.get(def.id) ?? '';
      image.width = 128;
      image.height = 128;
      image.alt = '';
      image.draggable = false;
      button.append(image);
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
    const status = element('#status', HTMLSpanElement);
    if (state.message !== this.lastMessage) {
      this.lastMessage = state.message;
      status.textContent = state.message;
      status.classList.add('visible');
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => status.classList.remove('visible'), 3000);
    }
    if (state.snapshot.structures.length > this.previousCount) this.dismissHint();
    this.previousCount = state.snapshot.structures.length;
    element('.selection-line', HTMLDivElement).hidden = state.tool.type === 'navigate';
    document.querySelectorAll<HTMLButtonElement>('[data-action="rotate"]').forEach((button) => {
      button.disabled = state.tool.type !== 'place';
    });
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
    feedback.hidden = !state.hover || state.tool.type === 'navigate' || this.hidden;
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
    feedback.style.left = `${Math.max(12, Math.min(innerWidth - feedback.offsetWidth - 12, x + 18))}px`;
    feedback.style.top = `${Math.max(12, Math.min(innerHeight - feedback.offsetHeight - 12, y - feedback.offsetHeight - 16))}px`;
  }
  toggleHelp(): void {
    const panel = element('#help-panel', HTMLElement);
    const open = panel.hidden;
    this.closeMenu();
    this.setLightingOpen(false);
    panel.hidden = !open;
  }
  toggleMenu(): void {
    const menu = element('#file-menu', HTMLDivElement);
    this.setLightingOpen(false);
    element('#help-panel', HTMLElement).hidden = true;
    menu.hidden = !menu.hidden;
    document.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded', String(!menu.hidden));
  }
  closeMenu(): void {
    element('#file-menu', HTMLDivElement).hidden = true;
    document.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded', 'false');
    this.setLightingOpen(false);
  }
  private setLightingOpen(open: boolean): void {
    element('#lighting-panel', HTMLDivElement).hidden = !open;
    document.querySelector('[data-action="lighting"]')?.setAttribute('aria-expanded', String(open));
  }
  private dismissHint(): void {
    element('#first-hint', HTMLParagraphElement).classList.add('dismissed');
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
    for (const selector of ['.topbar', '.bottom-ui', '.view-tools', '#help-panel']) {
      element(selector, HTMLElement).inert = hidden;
    }
    this.closeMenu();
    element('#help-panel', HTMLElement).hidden = true;
    const show = element('.show-interface', HTMLButtonElement);
    show.inert = !hidden;
    if (hidden) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    } else this.canvas.focus({ preventScroll: true });
    this.update();
  }
  lighting(preset: string): void {
    document.documentElement.dataset.light = preset;
    document.querySelectorAll<HTMLButtonElement>('[data-action^="light:"]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.action === `light:${preset}`));
    });
    this.setLightingOpen(false);
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
