import type { BufferGeometry } from 'three';

export interface DoorAnchor {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly heading: Readonly<{ x: number; z: number }>;
  readonly width: number;
}

const anchors = new WeakMap<BufferGeometry, DoorAnchor>();

export function setBuildingDoor(geometry: BufferGeometry, anchor: DoorAnchor): void {
  anchors.set(geometry, anchor);
  geometry.userData.door = anchor;
}

export function buildingDoor(geometry: BufferGeometry): DoorAnchor {
  const anchor = anchors.get(geometry);
  if (!anchor) throw new Error('Building geometry has no front entrance anchor');
  return anchor;
}
