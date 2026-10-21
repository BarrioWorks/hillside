import type { Command, CorePort, HexPoint, Preview, Snapshot } from './domain';
import { type Best, type Persistence, SAVE_KEY, UNREADABLE_KEY } from './persistence';

const RECOVERY = {
  swapped: 'No spot fits that tile, so it traded places with the next tile that does.',
  replaced: 'No tile in the deck fits anywhere, so the next one became open meadow.',
} as const;
export class Controller {
  snapshot: Snapshot;
  /** Sixth-turns applied to the tile in hand. */
  rotation = 0;
  hover: HexPoint | null = null;
  preview: Preview | null = null;
  message = 'A single settlement on the hillside. Place a tile beside it.';
  persistenceWarning = '';
  /** An original square-grid neighborhood remains in this browser and can be downloaded. */
  legacy = false;
  coreMilliseconds = 0;
  /** The personal best before the run that just ended, and whether that run beat it. */
  bestBefore: Best | null = null;
  newBest = false;
  /** True only right after a live placement reached victory, so a reload or load never celebrates again. */
  celebrate = false;
  private listeners = new Set<() => void>();
  constructor(
    readonly core: CorePort,
    private readonly persistence: Persistence,
  ) {
    this.snapshot = core.snapshot();
    let saved: string | null = null;
    try {
      saved = persistence.read();
      this.legacy = persistence.legacy() !== null;
    } catch {
      this.persistenceWarning = 'Browser storage is unavailable. Export a copy to keep your neighborhood.';
    }
    if (saved) {
      try {
        const result = core.restore(saved);
        if (result.ok) {
          this.snapshot = result.snapshot;
          this.message = result.message;
          this.showStoredBest();
        } else {
          // Keep it aside before the next autosave replaces it; the menu offers it for download.
          persistence.write(saved, UNREADABLE_KEY);
          this.legacy = true;
          this.message = `Your autosave could not be loaded. ${result.message} A copy is kept in the menu.`;
        }
      } catch {
        this.message = 'Your autosave could not be read. A fresh hillside is ready.';
      }
    } else if (this.legacy)
      this.message =
        'Barrio Builder now plays Classic runs with a deck and a score. Your earlier neighborhood is still kept; download it from the menu.';
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
  /** Turns the tile in hand clockwise (+1) or counterclockwise (-1). */
  rotate(direction: 1 | -1 = 1): void {
    this.rotation = (this.rotation + direction + 6) % 6;
    this.refreshPreview();
    this.emit();
  }
  point(hex: HexPoint | null): void {
    if (hex?.q === this.hover?.q && hex?.r === this.hover?.r) return;
    this.hover = hex;
    this.refreshPreview();
    this.emit();
  }
  private refreshPreview(): void {
    const open =
      this.hover &&
      this.snapshot.frontier.some((ground) => ground.q === this.hover?.q && ground.r === this.hover?.r);
    this.preview =
      this.hover && open && !this.snapshot.finished
        ? this.core.preview(this.hover.q, this.hover.r, this.rotation)
        : null;
  }
  place(): boolean {
    if (!this.hover || !this.preview || this.snapshot.finished) return false;
    return this.execute({ type: 'place', q: this.hover.q, r: this.hover.r, rotation: this.rotation });
  }
  skip(): boolean {
    return this.execute({ type: 'skip' });
  }
  execute(command: Command): boolean {
    const start = performance.now();
    const result = this.core.command(command);
    this.coreMilliseconds = performance.now() - start;
    this.message = result.message;
    this.celebrate = false;
    if (result.ok) {
      const ended = result.snapshot.finished && !this.snapshot.finished;
      this.celebrate = command.type === 'place' && !!result.snapshot.last?.victory;
      if (!ended) this.newBest = false;
      this.snapshot = result.snapshot;
      if (result.snapshot.recovery) this.message = `${result.message} ${RECOVERY[result.snapshot.recovery]}`;
      if (ended) this.recordBest();
      this.autosave();
    }
    this.refreshPreview();
    this.emit();
    return result.ok;
  }
  /** A loaded or restored run claims no record; its results show the stored best, if any. */
  private showStoredBest(): void {
    this.newBest = false;
    try {
      this.bestBefore = this.persistence.best(this.snapshot.rules);
    } catch {
      this.bestBefore = null;
    }
  }
  /** Keeps the best finished score per rules version on this device. */
  private recordBest(): void {
    const { rules, score, seed, regionName, placements, milestone } = this.snapshot;
    try {
      this.bestBefore = this.persistence.best(rules);
      this.newBest = !this.bestBefore || score > this.bestBefore.score;
      if (this.newBest)
        this.persistence.writeBest(rules, {
          score,
          seed,
          region: regionName,
          placements,
          milestone,
          date: new Date().toISOString().slice(0, 10),
        });
    } catch {
      this.newBest = false;
    }
  }
  private autosave(): void {
    try {
      this.persistence.write(this.core.save());
      this.persistenceWarning = '';
    } catch {
      this.persistenceWarning = 'Autosave is unavailable. Export a copy to keep your neighborhood.';
    }
  }
  save(): void {
    try {
      this.persistence.write(this.core.save(), SAVE_KEY);
      this.message = 'Neighborhood saved on this device.';
    } catch {
      this.message = 'Could not save on this device. Try exporting a copy.';
    }
    this.emit();
  }
  loadSaved(): void {
    try {
      const saved = this.persistence.read(SAVE_KEY);
      if (saved) this.load(saved);
      else {
        this.message = 'No saved neighborhood yet. Choose Save first.';
        this.emit();
      }
    } catch {
      this.message = 'Could not access your saved neighborhood.';
      this.emit();
    }
  }
  load(json: string): boolean {
    try {
      const result = this.core.load(json);
      this.message = result.message;
      if (result.ok) {
        this.snapshot = result.snapshot;
        this.celebrate = false;
        this.showStoredBest();
        this.autosave();
      }
      this.refreshPreview();
      this.emit();
      return result.ok;
    } catch {
      this.message = 'This file could not be read. Choose a Barrio neighborhood JSON file.';
      this.emit();
      return false;
    }
  }
  legacySave(): string | null {
    try {
      return this.persistence.legacy();
    } catch {
      return null;
    }
  }
  notify(message: string): void {
    this.message = message;
    this.emit();
  }
}
