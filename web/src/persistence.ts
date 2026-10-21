export const AUTOSAVE_KEY = 'barrio.autosave.v1';
export const SAVE_KEY = 'barrio.saved.v1';
export class Persistence {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}
  read(key = AUTOSAVE_KEY): string | null {
    return this.storage.getItem(key);
  }
  write(json: string, key = AUTOSAVE_KEY): void {
    this.storage.setItem(key, json);
  }
}
export function downloadSave(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'my-barrio.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
