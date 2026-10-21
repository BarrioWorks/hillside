import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export type AssetState =
  | { status: 'loading' }
  | { status: 'ready'; meshes: number; source: string }
  | { status: 'error'; message: string };
export async function loadLandmark(scene: THREE.Scene, onState: (state: AssetState) => void): Promise<void> {
  onState({ status: 'loading' });
  try {
    const gltf = await new GLTFLoader().loadAsync('/models/building-a.glb');
    let meshes = 0;
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        meshes++;
      }
    });
    if (meshes === 0) throw new Error('The model contains no visible meshes.');
    gltf.scene.position.set(16, -1.18, 35.8);
    gltf.scene.rotation.y = Math.PI;
    scene.add(gltf.scene);
    onState({ status: 'ready', meshes, source: 'Kenney City Kit Commercial · CC0' });
  } catch (error) {
    onState({
      status: 'error',
      message: error instanceof Error ? error.message : 'The community landmark could not be loaded.',
    });
  }
}
