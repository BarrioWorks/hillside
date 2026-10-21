import { beforeEach, describe, expect, it } from 'vitest';
import { Controller } from '../src/controller';
import { AUTOSAVE_KEY, Persistence, SAVE_KEY } from '../src/persistence';
import { realCore } from './core-fixture';

function emptyCell(controller: Controller, kind = 'casa') {
  const cell = controller.snapshot.cells.find(
    (cell) => controller.core.preview(kind, cell.x, cell.z, 0).valid,
  );
  if (!cell) throw new Error('No valid cell in fixture.');
  return { x: cell.x, z: cell.z };
}
beforeEach(() => localStorage.clear());
describe('playing against real Rust rules', () => {
  it('selects, rotates, builds, removes, undoes and redoes', () => {
    const controller = new Controller(realCore(), new Persistence(localStorage));
    const before = controller.snapshot.structures.length;
    controller.select({ type: 'place', kind: 'casa' });
    controller.rotate();
    expect(controller.rotation).toBe(1);
    controller.point(emptyCell(controller));
    expect(controller.preview?.valid).toBe(true);
    expect(controller.place()).toBe(true);
    expect(controller.snapshot.structures).toHaveLength(before + 1);
    controller.select({ type: 'remove' });
    expect(controller.place()).toBe(true);
    expect(controller.snapshot.structures).toHaveLength(before);
    controller.execute({ type: 'undo' });
    expect(controller.snapshot.structures).toHaveLength(before + 1);
    controller.execute({ type: 'redo' });
    expect(controller.snapshot.structures).toHaveLength(before);
  });
  it('uses Rust rejection and does not change an occupied footprint', () => {
    const controller = new Controller(realCore(), new Persistence(localStorage));
    controller.point(emptyCell(controller));
    expect(controller.place()).toBe(true);
    const before = controller.snapshot.structures.length;
    expect(controller.preview?.valid).toBe(false);
    expect(controller.place()).toBe(false);
    expect(controller.snapshot.structures).toHaveLength(before);
    expect(controller.message).not.toBe('');
  });
  it('does not place while exploring', () => {
    const controller = new Controller(realCore(), new Persistence(localStorage));
    controller.point(emptyCell(controller));
    controller.select({ type: 'navigate' });
    expect(controller.place()).toBe(false);
    expect(controller.preview).toBeNull();
  });
  it('autosaves, restores on restart, and explicitly saves and loads', () => {
    const controller = new Controller(realCore(), new Persistence(localStorage));
    controller.point(emptyCell(controller));
    controller.place();
    const expected = controller.snapshot.structures;
    expect(localStorage.getItem(AUTOSAVE_KEY)).not.toBeNull();
    controller.save();
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    const restarted = new Controller(realCore(), new Persistence(localStorage));
    expect(restarted.snapshot.structures).toEqual(expected);
    restarted.execute({ type: 'reset', seed: 42 });
    restarted.loadSaved();
    expect(restarted.snapshot.structures).toEqual(expected);
  });
  it('rejects malformed import atomically', () => {
    const controller = new Controller(realCore(), new Persistence(localStorage));
    const before = controller.snapshot;
    expect(controller.load('{"version":999,"structures":[]}')).toBe(false);
    expect(controller.snapshot).toEqual(before);
    expect(controller.load('not JSON')).toBe(false);
    expect(controller.snapshot).toEqual(before);
  });
  it('keeps building and exposes recovery when storage fails', () => {
    const unavailable = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const controller = new Controller(realCore(), new Persistence(unavailable));
    controller.point(emptyCell(controller));
    expect(controller.place()).toBe(true);
    expect(controller.persistenceWarning).toContain('Export');
  });
});
