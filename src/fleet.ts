import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { engineGlow } from './fx';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

function loadModel(name: string): Promise<THREE.Group> {
  if (!cache.has(name)) {
    cache.set(name, loader.loadAsync(`/models/${name}.glb`).then((g) => {
      const root = g.scene;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => {
          const s = mat as THREE.MeshStandardMaterial;
          if (!s.isMeshStandardMaterial) return;
          s.roughness = 0.5;
          s.metalness = 0.45;
          const c = s.color;
          // Bluish / cyan parts read as windows and running lights: make them glow for bloom.
          if (c.b > c.r * 1.4 && c.b > c.g * 1.05 && c.b > 0.3) {
            s.emissive = c.clone();
            s.emissiveIntensity = 2.5;
            return;
          }
          // Everything else: pull the toy colours toward grey military hull plating.
          const hsl = { h: 0, s: 0, l: 0 };
          c.getHSL(hsl);
          c.setHSL(hsl.h, hsl.s * 0.18, 0.25 + hsl.l * 0.45);
        });
      });
      return root;
    }));
  }
  return cache.get(name)!;
}

/** Sign of the Z half whose vertices spread widest in X. */
function wideEndZ(obj: THREE.Object3D): number {
  obj.updateMatrixWorld(true);
  let front = 0, back = 0, nf = 0, nb = 0;
  const v = new THREE.Vector3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.z > 0) { front += Math.abs(v.x); nf++; } else { back += Math.abs(v.x); nb++; }
    }
  });
  return (nf ? front / nf : 0) >= (nb ? back / nb : 0) ? 1 : -1;
}

/** Extra yaw per model so the nose points along -Z. */
const ORIENT: Record<string, number> = { fighter_a: -Math.PI / 2 };

export interface ShipVisual {
  root: THREE.Group;
  engines: THREE.Group[];
  length: number;
  seed: number;
}

/**
 * Load a model, scale it so its longest horizontal extent equals `length`, centre it,
 * and hang engine glows off its stern. Models are assumed to point along -Z (Three.js forward).
 */
export async function makeShip(name: string, length: number, engineColor: THREE.ColorRepresentation,
                               engineCount = 1): Promise<ShipVisual> {
  const src = await loadModel(name);
  const model = src.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.z);
  const scale = length / longest;
  model.scale.setScalar(scale);
  // If the model is longer along X, turn it so its length runs along Z.
  if (size.x > size.z) model.rotation.y = Math.PI / 2;
  // Fighters are wider at the back (wings) than the nose: if the wide end sits at -Z, spin it round.
  if (wideEndZ(model) < 0) model.rotation.y += Math.PI;
  // Models whose wingspan beats their length fool the heuristics above; fixed by eye.
  model.rotation.y += ORIENT[name] ?? 0;
  const box2 = new THREE.Box3().setFromObject(model);
  const centre = box2.getCenter(new THREE.Vector3());
  model.position.sub(centre);

  const root = new THREE.Group();
  root.add(model);
  const sz = box2.getSize(new THREE.Vector3());
  const engines: THREE.Group[] = [];
  const glowSize = Math.max(1.2, length * 0.06);
  for (let i = 0; i < engineCount; i++) {
    const t = engineCount === 1 ? 0 : (i / (engineCount - 1) - 0.5) * sz.x * 0.45;
    const e = engineGlow(engineColor, glowSize);
    e.position.set(t, 0, sz.z * 0.5 + glowSize * 0.3);
    root.add(e);
    engines.push(e);
  }
  return { root, engines, length, seed: Math.random() * 100 };
}

export async function makeRock(name: string, size: number): Promise<THREE.Group> {
  const src = await loadModel(name);
  const model = src.clone(true);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const s = m.material as THREE.MeshStandardMaterial;
      m.material = s.clone();
      (m.material as THREE.MeshStandardMaterial).color.multiplyScalar(0.55);
      (m.material as THREE.MeshStandardMaterial).roughness = 0.95;
      (m.material as THREE.MeshStandardMaterial).metalness = 0;
    }
  });
  const box = new THREE.Box3().setFromObject(model);
  const s = box.getSize(new THREE.Vector3());
  model.scale.setScalar(size / Math.max(s.x, s.y, s.z));
  const g = new THREE.Group();
  g.add(model);
  return g;
}
