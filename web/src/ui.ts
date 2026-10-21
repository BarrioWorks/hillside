import type { Controller } from './controller';
import { type Preview, type Quest, rotateSides } from './domain';
import { type IconName, icon } from './icons';
import { FAMILY_NAME, KIND_INFO, tileSvg } from './tileArt';
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
const number = new Intl.NumberFormat('en-US');
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const FAMILY_ICON = { residential: 'home', nature: 'tree', water: 'water' } as const;
const TIER_NAME = { small: 'Small', medium: 'Medium', large: 'Large' } as const;

/** A quest's goal in words. */
export function questGoal(quest: Pick<Quest, 'family' | 'target'>): string {
  switch (quest.family) {
    case 'residential':
      return `Connect ${quest.target} homes on one walk`;
    case 'nature':
      return `Grow a nature area of ${quest.target} tiles`;
    case 'water':
      return `Run a stream ${quest.target} tiles long`;
  }
}

/** A quest's reward in words. */
export function questReward(quest: Pick<Quest, 'points' | 'tiles'>): string {
  return `+${quest.points} · +${plural(quest.tiles, 'tile')}`;
}

/** The preview chip's lines: points, edges, and what happens to the paths. Built from the Rust preview only. */
export function previewLines(preview: Preview): { headline: string; details: string[] } {
  if (!preview.valid) {
    const turns = preview.validRotations.length;
    return {
      headline: 'Cannot place here',
      details: [
        preview.reason,
        turns
          ? `${plural(turns, 'other rotation')} ${turns === 1 ? 'fits' : 'fit'} here. Press R to turn the tile.`
          : 'No rotation of this tile fits this spot.',
      ],
    };
  }
  const { points, paths } = preview;
  const details = [
    `Base ${points.base} · ${plural(points.matches, 'matching edge')} +${points.matchPoints}${points.perfect ? ` · Perfect +${points.perfectBonus}` : ''}`,
  ];
  const walk: string[] = [];
  if (paths.joined) walk.push(`${plural(paths.joined, 'path')} ${paths.joined === 1 ? 'joins' : 'join'}`);
  if (paths.open) walk.push(`${paths.open} open`);
  if (paths.ended) walk.push(`${paths.ended} ${paths.ended === 1 ? 'ends' : 'end'} here`);
  if (paths.stairs) walk.push(`${plural(paths.stairs, 'stair')} built`);
  if (walk.length) details.push(walk.join(' · '));
  if (paths.steep) details.push(`${plural(paths.steep, 'path')} too steep to join: two terraces apart`);
  if (paths.homesGained) details.push(`+${plural(paths.homesGained, 'home')} on the main walk`);
  for (const quest of preview.completes)
    details.push(`Completes “${questGoal(quest)}”: ${questReward(quest)}`);
  return { headline: `+${points.total}${preview.perfect ? ' · Perfect placement' : ''}`, details };
}

export class UI {
  readonly canvas: HTMLCanvasElement;
  hidden = false;
  private lastMessage = '';
  private toastTimer = 0;
  private previousPlacements = 0;
  private handKey = '';
  private azimuth = 0;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(
    readonly controller: Controller,
    onAction: (action: string) => void,
  ) {
    const app = element('#app', HTMLDivElement);
    app.innerHTML = `<canvas id="world" aria-label="Neighborhood canvas. Point at an outlined spot to preview the tile, click to place it. Drag to orbit, right drag to pan, scroll to zoom." tabindex="0"></canvas>
    <header class="topbar"><div class="identity"><a class="brand" href="/" aria-label="Barrio Builder home"><svg class="brand-mark" width="26" height="26" viewBox="0 0 36 36" aria-hidden="true"><path fill="currentColor" d="M3 16h9v17H3zM14 5h9v28h-9zM25 12h8v21h-8z"/><path fill="#fffaf2" d="M6 20h3v3H6zm11-10h3v3h-3zm0 7h3v3h-3zm11 0h2v3h-2zM6 26h3v7H6zm11-2h3v9h-3zm11 1h2v8h-2z"/></svg><span>barrio</span></a><span id="region" class="count-chip"></span></div>
    <section class="scoreboard" aria-label="Score"><span class="score-label">Score</span><strong id="score" aria-live="polite">0</strong><span id="milestone" class="milestone"><span class="milestone-bar"><span id="milestone-fill"></span></span><span id="milestone-text"></span></span><span id="score-detail" class="score-detail"></span><button type="button" id="run-action" class="run-action" hidden></button></section>
    <div class="top-actions"><div class="lighting-wrap">${button('lighting', 'Change lighting', 'sun', 'aria-expanded="false" aria-controls="lighting-panel"')}<div id="lighting-panel" class="lighting-panel" hidden><h2>A little change of light</h2>${button('light:afternoon', 'Warm afternoon', 'sunset', 'aria-pressed="true"')}${button('light:daylight', 'Bright daylight', 'sun', 'aria-pressed="false"')}${button('light:evening', 'Soft evening', 'moon', 'aria-pressed="false"')}</div></div>${button('hide-ui', 'Hide interface (H)', 'eye-off')}${button('save', 'Save', 'save', 'class="save-button"')}<div class="menu-wrap">${button('menu', 'Neighborhood menu', 'more', 'aria-expanded="false" aria-controls="file-menu"')}<div id="file-menu" class="file-menu" hidden><h2>Your neighborhood</h2><button data-action="load">${icon('save')}Load saved run</button><button data-action="export">${icon('download')}Export a copy</button><button data-action="import">${icon('upload')}Import a run</button><button data-action="export-legacy" id="legacy-export" hidden>${icon('download')}Download an older save</button><button data-action="help">${icon('help')}How to play</button><button data-action="sound" class="menu-sound">${icon('sound')}Mute sound</button><hr/><button data-action="new">${icon('plus')}New game</button><small>Private by nature. Saved on this device.</small></div></div></div></header>
    ${button('hide-ui', 'Show interface (H)', 'eye', 'class="show-interface" inert')}
    <aside class="quests" id="quests" aria-label="Quests"><h2>Quests</h2><ol id="quest-list"></ol></aside>
    <div class="view-tools" role="group" aria-label="Camera controls">${button('zoom-in', 'Zoom in', 'plus')}${button('zoom-out', 'Zoom out', 'minus')}<span class="tool-divider"></span>${button('rotate-left', 'Turn the view left (Q)', 'rotate-left')}${button('rotate-right', 'Turn the view right (E)', 'rotate-right')}${button('home', 'Show the whole neighborhood', 'home')}</div>
    <aside class="help-panel" id="help-panel" aria-label="How to play" hidden><div><h2>Grow the barrio one tile at a time.</h2>${button('help', 'Close help', 'close')}</div><p>Every tile has six edges: homes, paths, nature, or water. Place each tile beside the neighborhood. Edges that match score points.</p><dl><dt>Place a tile</dt><dd>Point at an outlined spot to preview it and its points. Click to place. Turn it with <kbd>R</kbd> or the arrows beside the tile.</dd><dt>Score</dt><dd>Each tile scores 10, plus 20 for every edge that matches its neighbor. Surround a spot and match all six edges for a 60-point perfect bonus.</dd><dt>Water</dt><dd>Streams must flow into streams. Land cannot touch water, and water cannot touch land. A stream may end at an empty spot.</dd><dt>Paths</dt><dd>Matching path edges join walks. Stairs climb one terrace; two terraces is too steep. Homes count once a path reaches their door.</dd><dt>Quests</dt><dd>Three quests ask for homes on one walk, a large nature area, and a long stream. Completing one pays points and adds tiles to the deck; the next, larger quest of that kind takes its place.</dd><dt>The deck</dt><dd>You see the tile in hand and the next two. You may skip once per run: the tile goes to the back of the deck. Reach 6,000 points for victory, then keep building or finish. The run ends when the deck is empty.</dd><dt>A few handy keys</dt><dd><kbd>R</kbd> Turn tile · <kbd>Shift R</kbd> Turn back · <kbd>S</kbd> Skip<br/><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> Move between spots · <kbd>Enter</kbd> Place<br/><kbd>Q</kbd> <kbd>E</kbd> Turn the view · <kbd>H</kbd> Hide interface · <kbd>Ctrl S</kbd> Save</dd></dl><p class="help-note">No timers. Take your time.</p></aside>
    <div class="bottom-ui"><div class="toast-region"><span id="status" role="status" aria-live="polite" aria-atomic="true"></span></div><p class="first-hint" id="first-hint">${
      matchMedia('(pointer: coarse)').matches
        ? 'Tap an outlined spot to preview · Tap again to place'
        : 'Point at an outlined spot · <kbd>R</kbd> turns the tile · Click to place'
    }</p>
    <section class="hand" aria-label="Tiles"><div class="hand-next" id="hand-next" aria-label="Coming next"></div><div class="hand-current">${button('rotate-tile-back', 'Turn tile back (Shift R)', 'rotate-left', 'class="turn"')}<div id="hand-tile" class="hand-tile" role="img"></div>${button('rotate-tile', 'Turn tile (R)', 'rotate-right', 'class="turn"')}</div><div class="deck-info"><span id="remaining" class="remaining"></span><button type="button" data-action="skip" id="skip" class="skip">Skip</button></div><div class="hand-caption"><strong id="hand-title"></strong><span id="hand-description"></span></div></section></div>
    <div id="placement-feedback" class="placement-feedback" hidden></div><div id="floaters" class="floaters" aria-hidden="true"></div><div id="storage-warning" class="storage-warning" role="status" hidden></div><input id="import-file" type="file" accept="application/json,.json" hidden/>
    <aside id="victory" class="results victory" aria-labelledby="victory-title" hidden><span class="victory-mark">${icon('star')}</span><h2 id="victory-title">Thriving Barrio</h2><p id="victory-text"></p><div class="results-actions"><button type="button" data-action="continue" class="primary">Continue building</button><button type="button" data-action="finish">Finish and view results</button></div></aside>
    <aside id="results" class="results" aria-labelledby="results-title" hidden><h2 id="results-title">Run complete</h2><p id="results-reason" class="results-reason"></p><p class="results-score"><strong id="results-score">0</strong> points</p><p id="results-best" class="results-best"></p><dl id="results-stats"></dl><div class="results-actions"><button type="button" data-action="new-run" class="primary">New game</button><button type="button" data-action="replay">Replay seed</button><button type="button" data-action="view">View neighborhood</button><button type="button" data-action="share">${icon('share')}Share screenshot</button></div></aside>
    <dialog id="new-dialog"><form method="dialog"><h2>Start a new run?</h2><p>A new run replaces this run’s autosave. Export a copy first if you’d like to keep it.</p><div><button value="cancel">Keep building</button><button value="new" class="primary">New game</button></div></form></dialog>`;
    this.canvas = element('#world', HTMLCanvasElement);
    this.previousPlacements = controller.snapshot.placements;
    window.setTimeout(() => this.dismissHint(), 12000);
    app.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest('button');
      if (!(target instanceof HTMLButtonElement)) return;
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
  /** Keeps the tile drawings turned the same way as the world on screen. */
  viewAzimuth(radians: number): void {
    const degrees = Math.round((radians * 180) / Math.PI);
    if (degrees === this.azimuth) return;
    this.azimuth = degrees;
    document.documentElement.style.setProperty('--view-turn', `${degrees}deg`);
  }
  private renderHand(): void {
    const { snapshot, rotation } = this.controller;
    const current = snapshot.current;
    const key = `${snapshot.revision}/${rotation}/${current?.kind}`;
    if (key === this.handKey) return;
    this.handKey = key;
    const tile = element('#hand-tile', HTMLDivElement);
    element('#remaining', HTMLSpanElement).textContent =
      `${snapshot.remaining} ${snapshot.remaining === 1 ? 'tile' : 'tiles'} left`;
    const skip = element('#skip', HTMLButtonElement);
    skip.disabled = !snapshot.canSkip;
    skip.textContent = snapshot.skipUsed ? 'Skip used' : 'Skip';
    skip.title = snapshot.skipUsed
      ? 'The skip has been used this run.'
      : snapshot.canSkip
        ? 'Move this tile to the back of the deck (S). Once per run.'
        : 'Skipping needs another tile in the deck.';
    element('.hand', HTMLElement).classList.toggle('empty', !current);
    if (!current) {
      tile.innerHTML = '';
      tile.setAttribute('aria-label', 'No tiles left');
      element('#hand-title', HTMLElement).textContent = 'The deck is empty';
      element('#hand-description', HTMLSpanElement).textContent = 'Your neighborhood is complete.';
      element('#hand-next', HTMLDivElement).innerHTML = '';
      return;
    }
    const info = KIND_INFO[current.kind];
    tile.innerHTML = tileSvg(
      current.kind,
      rotateSides(current.edges, rotation),
      rotateSides(current.paths, rotation),
      112,
    );
    tile.setAttribute(
      'aria-label',
      `${info.name}, ${FAMILY_NAME[current.family]} tile, turned ${rotation} of 6`,
    );
    element('#hand-title', HTMLElement).textContent = `${info.name} · ${FAMILY_NAME[current.family]}`;
    element('#hand-description', HTMLSpanElement).textContent = info.description;
    element('#hand-next', HTMLDivElement).innerHTML = snapshot.upcoming
      .map(
        (spec, index) =>
          `<span class="next-tile" title="${index === 0 ? 'Next' : 'After that'}: ${KIND_INFO[spec.kind].name} (${FAMILY_NAME[spec.family]})">${tileSvg(spec.kind, spec.edges, spec.paths, 60)}</span>`,
      )
      .join('');
  }
  update(): void {
    const state = this.controller;
    const snapshot = state.snapshot;
    this.renderHand();
    const status = element('#status', HTMLSpanElement);
    if (state.message !== this.lastMessage) {
      this.lastMessage = state.message;
      status.textContent = state.message;
      status.classList.add('visible');
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => status.classList.remove('visible'), 3200);
    }
    if (snapshot.placements > this.previousPlacements) this.dismissHint();
    this.previousPlacements = snapshot.placements;
    const stats = snapshot.stats;
    element('#region', HTMLSpanElement).textContent = `${snapshot.regionName} · seed ${snapshot.seed}`;
    element('#score', HTMLElement).textContent = number.format(snapshot.score);
    element('#score-detail', HTMLSpanElement).textContent =
      `${plural(snapshot.placements, 'tile')} placed · ${stats.homesConnected} of ${plural(stats.homes, 'home')} on the main walk`;
    element('#legacy-export', HTMLButtonElement).hidden = !state.legacy;
    const feedback = element('#placement-feedback', HTMLDivElement);
    const preview = state.preview;
    feedback.hidden = !preview || this.hidden || snapshot.finished;
    feedback.classList.toggle('invalid', preview?.valid === false);
    feedback.classList.toggle('perfect', !!preview?.valid && preview.perfect);
    if (preview) {
      const { headline, details } = previewLines(preview);
      feedback.innerHTML = `<span class="feedback-head">${icon(preview.valid ? 'check' : 'close')}<strong>${escapeHtml(headline)}</strong></span>${details
        .map((line) => `<span>${escapeHtml(line)}</span>`)
        .join('')}`;
    }
    this.renderQuests();
    this.renderMilestone();
    this.renderVictory();
    this.renderResults();
    this.renderRunAction();
    const warning = element('#storage-warning', HTMLDivElement);
    warning.textContent = state.persistenceWarning;
    warning.hidden = !state.persistenceWarning;
  }
  private questsKey = '';
  private questsRun = '';
  private questsPlacements = 0;
  private shownQuests = new Map<string, number>();
  private questTimer = 0;
  /** Up to three quest cards. Progress that rises pulses; a completed quest shows briefly, then its successor. */
  private renderQuests(): void {
    const { snapshot } = this.controller;
    const key = `${snapshot.seed}/${snapshot.revision}`;
    if (key === this.questsKey) return;
    this.questsKey = key;
    // A new game, a replay or a load starts over: nothing animates against the previous run's cards.
    if (this.questsRun !== String(snapshot.seed) || snapshot.placements < this.questsPlacements)
      this.shownQuests = new Map();
    this.questsRun = String(snapshot.seed);
    this.questsPlacements = snapshot.placements;
    const list = element('#quest-list', HTMLOListElement);
    const done = snapshot.last && snapshot.placements > 0 ? snapshot.last.completed.map((c) => c.quest) : [];
    const fresh = done.length > 0 && done.every((quest) => this.shownQuests.has(quest.id));
    const card = (quest: Quest, state: string) => {
      const share = Math.min(1, quest.progress / quest.target);
      const status =
        quest.state === 'outOfReach'
          ? 'Out of reach for now: the deck cannot supply enough.'
          : quest.state === 'completed'
            ? 'Complete'
            : `${Math.min(quest.progress, quest.target)} / ${quest.target}`;
      return `<li class="quest ${quest.family} ${state} ${quest.state}" data-id="${quest.id}"><span class="quest-icon">${icon(FAMILY_ICON[quest.family])}</span><span class="quest-body"><span class="quest-title"><strong>${questGoal(quest)}</strong><em>${TIER_NAME[quest.tier]}</em></span><span class="quest-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${quest.target}" aria-valuenow="${Math.min(quest.progress, quest.target)}"><span style="width:${(share * 100).toFixed(1)}%"></span></span><span class="quest-meta"><span>${status}</span><span>${questReward(quest)}</span></span></span></li>`;
    };
    const render = () => {
      const cards = snapshot.quests.current.map((quest) => {
        const before = this.shownQuests.get(quest.id);
        return card(quest, before !== undefined && quest.progress > before ? 'advanced' : '');
      });
      list.innerHTML = cards.join('') || '<li class="quest none">Every quest is complete.</li>';
      this.shownQuests = new Map(snapshot.quests.current.map((quest) => [quest.id, quest.progress]));
    };
    window.clearTimeout(this.questTimer);
    if (fresh) {
      // Show each completed quest in its place for a moment before its successor takes over.
      const showing = snapshot.quests.current.map((quest) => {
        const finished = done.find((d) => d.family === quest.family);
        return finished ? card(finished, 'done') : card(quest, '');
      });
      for (const finished of done)
        if (!snapshot.quests.current.some((quest) => quest.family === finished.family))
          showing.push(card(finished, 'done'));
      list.innerHTML = showing.join('');
      this.questTimer = window.setTimeout(render, this.reducedMotion ? 1600 : 1400);
    } else render();
  }
  private renderMilestone(): void {
    const { snapshot } = this.controller;
    const next = snapshot.nextMilestone;
    const thresholds = [0, 1000, 3000, 6000];
    const floor = next ? (thresholds[thresholds.indexOf(next.score) - 1] ?? 0) : 6000;
    const share = next ? (snapshot.score - floor) / (next.score - floor) : 1;
    element('#milestone-fill', HTMLSpanElement).style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
    element('#milestone-text', HTMLSpanElement).textContent = next
      ? `${snapshot.milestone ? `${snapshot.milestone} · ` : ''}Next: ${next.name} at ${number.format(next.score)}`
      : `${snapshot.milestone ?? ''} · victory reached`;
  }
  private victoryShown = '';
  /** A short celebration the moment a placement reaches victory; it never fires again for the run. */
  private renderVictory(): void {
    const { snapshot } = this.controller;
    const panel = element('#victory', HTMLElement);
    // The revision of the winning placement, so a replayed seed that wins again celebrates again.
    const key = `${snapshot.seed}/${snapshot.revision}`;
    if (!this.controller.celebrate || snapshot.finished || this.victoryShown === key) {
      if (snapshot.finished || !snapshot.victory) panel.hidden = true;
      return;
    }
    this.victoryShown = key;
    element('#victory-text', HTMLParagraphElement).textContent =
      `${number.format(snapshot.score)} points in ${plural(snapshot.placements, 'placement')}, with ${snapshot.stats.homesConnected} homes on the main walk and ${plural(snapshot.quests.history.length, 'quest')} complete. Keep building with the ${plural(snapshot.remaining, 'tile')} left, or finish to see your results.`;
    panel.hidden = false;
  }
  hideVictory(): void {
    element('#victory', HTMLElement).hidden = true;
  }
  private resultsShown = '';
  private renderResults(): void {
    const { snapshot, bestBefore, newBest } = this.controller;
    const results = element('#results', HTMLElement);
    const key = `${snapshot.seed}/${snapshot.revision}`;
    document.body.classList.toggle('run-over', snapshot.finished && !results.hidden);
    if (!snapshot.finished) {
      results.hidden = true;
      document.body.classList.remove('run-over');
      this.resultsShown = '';
      return;
    }
    if (this.resultsShown === key) return;
    this.resultsShown = key;
    results.hidden = false;
    document.body.classList.add('run-over');
    element('#results-title', HTMLElement).textContent = snapshot.victory
      ? 'Thriving Barrio'
      : 'Run complete';
    element('#results-reason', HTMLParagraphElement).textContent =
      snapshot.end === 'finished'
        ? `You finished after reaching victory, with ${plural(snapshot.remaining, 'tile')} still in the deck.`
        : 'The deck is empty: every tile has found its place.';
    element('#results-score', HTMLElement).textContent = number.format(snapshot.score);
    element('#results-best', HTMLParagraphElement).textContent = newBest
      ? bestBefore
        ? `New personal best. Previous best: ${number.format(bestBefore.score)} (${bestBefore.region}, seed ${bestBefore.seed}).`
        : 'Your first finished run under these rules: a new personal best.'
      : bestBefore
        ? `Personal best: ${number.format(bestBefore.score)} (${bestBefore.region}, seed ${bestBefore.seed}).`
        : '';
    const rows: [string, string][] = [
      ['Highest milestone', snapshot.milestone ?? 'None yet'],
      ['Tiles placed', String(snapshot.placements)],
      ['Connected homes', `${snapshot.stats.homesConnected} of ${snapshot.stats.homes}`],
      ['Quests completed', String(snapshot.quests.history.length)],
      ['Largest nature area', plural(snapshot.stats.largestNature, 'tile')],
      ['Longest stream', plural(snapshot.stats.largestWater, 'tile')],
      ['Region and seed', `${snapshot.regionName} · ${snapshot.seed}`],
    ];
    element('#results-stats', HTMLElement).innerHTML = rows
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join('');
  }
  /** Whether the victory or results panel covers the game, so game keys should wait. */
  get overlayOpen(): boolean {
    return !element('#victory', HTMLElement).hidden || !element('#results', HTMLElement).hidden;
  }
  showResults(): void {
    element('#results', HTMLElement).hidden = false;
    document.body.classList.add('run-over');
    this.update();
  }
  /** A lasting way to finish a won run, or to reopen the results after viewing the neighborhood. */
  private renderRunAction(): void {
    const { snapshot } = this.controller;
    const action = element('#run-action', HTMLButtonElement);
    const resultsOpen = !element('#results', HTMLElement).hidden;
    if (snapshot.victory && !snapshot.finished) {
      action.hidden = false;
      action.dataset.action = 'finish';
      action.textContent = 'Finish run';
    } else if (snapshot.finished && !resultsOpen) {
      action.hidden = false;
      action.dataset.action = 'results';
      action.textContent = 'Results';
    } else action.hidden = true;
  }
  hideResults(): void {
    element('#results', HTMLElement).hidden = true;
    document.body.classList.remove('run-over');
    this.renderRunAction();
  }
  /** Brief points text rising from a placed tile. Reduced motion holds it still and fades it. */
  floatScore(text: string, x: number, y: number, perfect = false): void {
    if (this.hidden) return;
    const floater = document.createElement('span');
    floater.className = `floater${perfect ? ' perfect' : ''}${this.reducedMotion ? ' still' : ''}`;
    floater.textContent = text;
    // Keep clear of the scoreboard and the tray, and inside the screen.
    floater.style.left = `${Math.max(160, Math.min(innerWidth - 160, x))}px`;
    floater.style.top = `${Math.max(150, Math.min(innerHeight - 220, y))}px`;
    element('#floaters', HTMLDivElement).append(floater);
    window.setTimeout(() => floater.remove(), this.reducedMotion ? 1800 : 1300);
  }
  feedbackPosition(x: number, y: number): void {
    const feedback = element('#placement-feedback', HTMLDivElement);
    feedback.style.left = `${Math.max(12, Math.min(innerWidth - feedback.offsetWidth - 12, x + 18))}px`;
    feedback.style.top = `${Math.max(12, Math.min(innerHeight - feedback.offsetHeight - 12, y - feedback.offsetHeight - 16))}px`;
  }
  /**
   * Puts the preview chip beside the hovered hex, not over it, so the ghost tile and its edge markers stay
   * visible. It goes right of the hex when there is room, otherwise left.
   */
  anchorFeedback(x: number, y: number, radius: number): void {
    const feedback = element('#placement-feedback', HTMLDivElement);
    const width = feedback.offsetWidth || 220;
    const height = feedback.offsetHeight || 60;
    const gap = radius * 1.05 + 10;
    const left = x + gap + width < innerWidth - 12 ? x + gap : x - gap - width;
    feedback.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, left))}px`;
    feedback.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, y - height / 2))}px`;
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
}
