import { describe, expect, it } from 'vitest';
import { PointerGesture } from '../src/input';

describe('pointer intent', () => {
  it('accepts a click with small finger movement', () => {
    const gesture = new PointerGesture();
    gesture.down(1, 20, 20);
    gesture.move(1, 22, 22);
    expect(gesture.up(1)).toBe(true);
  });
  it('does not build after a camera drag or a drag returning to its origin', () => {
    const gesture = new PointerGesture();
    gesture.down(1, 20, 20);
    gesture.move(1, 100, 20);
    gesture.move(1, 20, 20);
    expect(gesture.up(1)).toBe(false);
  });
  it('does not build at the end of a two-finger camera gesture', () => {
    const gesture = new PointerGesture();
    gesture.down(1, 20, 20);
    gesture.down(2, 50, 50);
    expect(gesture.up(1)).toBe(false);
    expect(gesture.up(2)).toBe(false);
    gesture.down(1, 20, 20);
    expect(gesture.up(1)).toBe(true);
  });
  it('cancels interrupted pointers', () => {
    const gesture = new PointerGesture();
    gesture.down(1, 20, 20);
    gesture.cancel(1);
    expect(gesture.up(1)).toBe(false);
  });
});
