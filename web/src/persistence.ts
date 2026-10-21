export const AUTOSAVE_KEY = 'barrio.autosave.v3';
export const SAVE_KEY = 'barrio.saved.v3';
/** An autosave this version could not restore, kept aside before a new run can overwrite it. */
export const UNREADABLE_KEY = 'barrio.autosave.unreadable';
/**
 * Saves this version cannot play: an unreadable autosave, then the square sandbox (v1) and free hex
 * building (v2). They are never overwritten by a run, only offered for download. Newest first.
 */
export const LEGACY_KEYS = [
  UNREADABLE_KEY,
  'barrio.autosave.v2',
  'barrio.saved.v2',
  'barrio.autosave.v1',
  'barrio.saved.v1',
] as const;
/** A personal best. Bests are kept per rules version, so a rules change starts a fresh record. */
export interface Best {
  score: number;
  seed: number;
  region: string;
  placements: number;
  milestone: string | null;
  date: string;
}
export const bestKey = (rules: string) => `barrio.best.${rules}`;
export class Persistence {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}
  best(rules: string): Best | null {
    try {
      const value = JSON.parse(this.storage.getItem(bestKey(rules)) ?? 'null');
      return value && typeof value.score === 'number' ? (value as Best) : null;
    } catch {
      return null;
    }
  }
  writeBest(rules: string, best: Best): void {
    this.storage.setItem(bestKey(rules), JSON.stringify(best));
  }
  read(key = AUTOSAVE_KEY): string | null {
    return this.storage.getItem(key);
  }
  write(json: string, key = AUTOSAVE_KEY): void {
    this.storage.setItem(key, json);
  }
  /** The newest neighborhood kept from an earlier version, if any. */
  legacy(): string | null {
    for (const key of LEGACY_KEYS) {
      const value = this.storage.getItem(key);
      if (value) return value;
    }
    return null;
  }
}
export function downloadSave(json: string, name = 'my-barrio.json'): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
