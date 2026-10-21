import type { BuildingDefinition, CellPoint, Command, CorePort, Preview, Snapshot, Tool } from './domain';
import { type Persistence, SAVE_KEY } from './persistence';
export class Controller {
  readonly catalog: BuildingDefinition[];
  snapshot: Snapshot;
  tool: Tool = { type: 'place', kind: 'casa' };
  rotation = 0;
  hover: CellPoint | null = null;
  preview: Preview | null = null;
  message = 'A little hillside. Make it yours.';
  persistenceWarning = '';
  coreMilliseconds = 0;
  private listeners = new Set<() => void>();
  constructor(
    readonly core: CorePort,
    private readonly persistence: Persistence,
  ) {
    this.catalog = core.catalog();
    this.snapshot = core.snapshot();
    try {
      const saved = persistence.read();
      if (saved) {
        const result = core.load(saved);
        if (result.ok) {
          this.snapshot = result.snapshot;
          this.message = 'Welcome back to your neighborhood.';
        } else this.message = `Your autosave could not be loaded. ${result.message}`;
      }
    } catch {
      this.persistenceWarning = 'Browser storage is unavailable. Export a copy to keep your neighborhood.';
    }
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
  select(tool: Tool): void {
    this.tool = tool;
    this.refreshPreview();
    this.emit();
  }
  rotate(): void {
    this.rotation = (this.rotation + 1) % 4;
    this.refreshPreview();
    this.emit();
  }
  point(cell: CellPoint | null): void {
    if (cell?.x === this.hover?.x && cell?.z === this.hover?.z) return;
    this.hover = cell;
    this.refreshPreview();
    this.emit();
  }
  private refreshPreview(): void {
    this.preview =
      this.hover && this.tool.type === 'place'
        ? this.core.preview(this.tool.kind, this.hover.x, this.hover.z, this.rotation)
        : null;
  }
  place(): boolean {
    if (!this.hover || this.tool.type === 'navigate') return false;
    if (this.tool.type === 'place')
      return this.execute({ type: 'place', kind: this.tool.kind, ...this.hover, rotation: this.rotation });
    return this.execute({ type: 'remove', ...this.hover });
  }
  execute(command: Command): boolean {
    const start = performance.now();
    const result = this.core.command(command);
    this.coreMilliseconds = performance.now() - start;
    this.message = result.message;
    if (result.ok) {
      this.snapshot = result.snapshot;
      this.autosave();
    }
    this.refreshPreview();
    this.emit();
    return result.ok;
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
  notify(message: string): void {
    this.message = message;
    this.emit();
  }
}
