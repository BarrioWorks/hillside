export class PointerGesture {
  private active = new Map<number, { x: number; y: number }>();
  private dragged = false;
  down(id: number, x: number, y: number): void {
    if (this.active.size === 0) this.dragged = false;
    this.active.set(id, { x, y });
    if (this.active.size > 1) this.dragged = true;
  }
  move(id: number, x: number, y: number): void {
    const start = this.active.get(id);
    if (start && Math.hypot(x - start.x, y - start.y) > 6) this.dragged = true;
  }
  up(id: number): boolean {
    const existed = this.active.delete(id);
    return existed && !this.dragged && this.active.size === 0;
  }
  cancel(id: number): void {
    this.active.delete(id);
    this.dragged = true;
  }
}
