import * as THREE from 'three';
import { engineGlow, glowSprite } from './fx';
import type { ShipVisual } from './fleet';

/** Tiny seeded RNG so a capital ship is reproducible per seed. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export interface CapitalOptions { length: number; accent: THREE.ColorRepresentation; engine: THREE.ColorRepresentation; seed: number; }

/**
 * Procedural capital ship, Homeworld style: a long armoured hull built from stacked boxes,
 * a bridge tower, hangar sponsons, an engine block with three nozzles, hundreds of greebles,
 * rows of emissive windows and a few blinking running lights. Nose points along -Z.
 */
export function makeCapital(o: CapitalOptions): ShipVisual {
  const r = rng(o.seed);
  const L = o.length;
  const root = new THREE.Group();
  const hull = new THREE.Group();
  root.add(hull);

  const matHull = new THREE.MeshStandardMaterial({ color: 0x9aa1a9, roughness: 0.48, metalness: 0.55 });
  const matPanel = new THREE.MeshStandardMaterial({ color: 0x6c737c, roughness: 0.6, metalness: 0.5 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.7, metalness: 0.4 });
  const matAccent = new THREE.MeshStandardMaterial({ color: o.accent, roughness: 0.5, metalness: 0.3 });
  const matWindow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd9a0, emissiveIntensity: 3.5, roughness: 1 });

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D = hull) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // ---- Main hull: three overlapping segments, slightly tapered toward the prow.
  const W = L * 0.2, H = L * 0.12;
  box(W, H, L * 0.5, 0, 0, L * 0.05, matHull);
  box(W * 0.85, H * 0.85, L * 0.3, 0, 0, -L * 0.3, matHull);
  box(W * 0.55, H * 0.6, L * 0.2, 0, H * 0.05, -L * 0.52, matPanel);          // prow
  box(W * 0.3, H * 0.3, L * 0.12, 0, H * 0.1, -L * 0.66, matDark);              // ram / sensor spike
  // Armoured belly and dorsal plating
  box(W * 0.7, H * 0.25, L * 0.55, 0, -H * 0.55, L * 0.02, matPanel);
  box(W * 0.45, H * 0.3, L * 0.6, 0, H * 0.55, -L * 0.02, matPanel);
  // Dorsal spine
  box(W * 0.12, H * 0.25, L * 0.62, 0, H * 0.75, -L * 0.03, matDark);

  // ---- Hangar sponsons left and right, with an accent stripe and a lit bay mouth.
  for (const sx of [-1, 1]) {
    box(W * 0.35, H * 0.7, L * 0.34, sx * W * 0.62, -H * 0.1, L * 0.02, matHull);
    box(W * 0.37, H * 0.08, L * 0.3, sx * W * 0.62, H * 0.28, L * 0.02, matAccent);
    box(W * 0.04, H * 0.4, L * 0.1, sx * W * 0.8, -H * 0.1, -L * 0.1, matWindow);  // hangar glow
    const bay = glowSprite(0xffc27a, L * 0.08, 0.6);
    bay.position.set(sx * W * 0.83, -H * 0.1, -L * 0.1);
    hull.add(bay);
  }

  // ---- Bridge tower near the stern.
  const bz = L * 0.2;
  box(W * 0.45, H * 0.5, L * 0.14, 0, H * 0.9, bz, matHull);
  box(W * 0.3, H * 0.45, L * 0.1, 0, H * 1.35, bz - L * 0.01, matPanel);
  box(W * 0.34, H * 0.12, L * 0.02, 0, H * 1.45, bz - L * 0.065, matWindow);    // bridge windows
  box(W * 0.03, H * 1.2, W * 0.03, 0, H * 2.1, bz + L * 0.02, matDark);          // mast
  box(W * 0.2, H * 0.06, W * 0.03, 0, H * 2.5, bz + L * 0.02, matDark);          // yardarm
  box(W * 0.03, H * 0.6, W * 0.03, W * 0.15, H * 1.75, bz + L * 0.05, matDark);
  box(W * 0.03, H * 0.6, W * 0.03, -W * 0.15, H * 1.75, bz + L * 0.05, matDark);

  // ---- Turrets along the dorsal spine and belly.
  for (let i = 0; i < 5; i++) {
    const z = -L * 0.35 + i * L * 0.14;
    const y = i % 2 === 0 ? H * 0.78 : -H * 0.72;
    box(W * 0.14, H * 0.12, W * 0.14, 0, y, z, matPanel);
    box(W * 0.02, H * 0.03, W * 0.3, 0, y + (y > 0 ? H * 0.06 : -H * 0.06), z - W * 0.12, matDark);
  }

  // ---- Engine block and nozzles.
  const ez = L * 0.37;
  box(W * 1.05, H * 1.0, L * 0.14, 0, 0, ez, matPanel);
  box(W * 1.1, H * 0.2, L * 0.1, 0, H * 0.58, ez, matAccent);
  const engines: THREE.Group[] = [];
  const nozzleGeo = new THREE.CylinderGeometry(H * 0.22, H * 0.3, L * 0.08, 16, 1, true);
  nozzleGeo.rotateX(Math.PI / 2);
  for (const sx of [-1, 0, 1]) {
    const nz = new THREE.Mesh(nozzleGeo, new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }));
    nz.position.set(sx * W * 0.34, 0, ez + L * 0.1);
    hull.add(nz);
    const e = engineGlow(o.engine, H * 0.42);
    e.position.set(sx * W * 0.34, 0, ez + L * 0.12);
    root.add(e);
    engines.push(e);
  }

  // ---- Greebles: hundreds of small blocks scattered over the hull faces.
  const greebleGeo = new THREE.BoxGeometry(1, 1, 1);
  const greebles = new THREE.InstancedMesh(greebleGeo, matDark, 260);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  for (let i = 0; i < 260; i++) {
    const face = r();
    const z = (r() - 0.5) * L * 0.75 - L * 0.05;
    const sz = L * (0.006 + r() * 0.02);
    if (face < 0.4) p3.set((r() - 0.5) * W * 0.9, H * 0.5 + (r() < 0.5 ? H * 0.2 : 0), z);           // top
    else if (face < 0.6) p3.set((r() - 0.5) * W * 0.9, -H * 0.5 - (r() < 0.5 ? H * 0.12 : 0), z);  // bottom
    else p3.set((r() < 0.5 ? -1 : 1) * (W * 0.5 + (r() < 0.4 ? W * 0.3 : 0)), (r() - 0.5) * H * 0.8, z); // sides
    s3.set(sz * (0.5 + r()), sz * (0.3 + r() * 0.7), sz * (0.5 + r() * 2.5));
    m4.compose(p3, q, s3);
    greebles.setMatrixAt(i, m4);
  }
  hull.add(greebles);

  // ---- Windows: rows of tiny emissive slits along both flanks and the sponsons.
  const win = new THREE.InstancedMesh(greebleGeo, matWindow, 320);
  for (let i = 0; i < 320; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const onSponson = r() < 0.35;
    const x = side * (onSponson ? W * 0.795 : W * 0.5 + 0.01 * L);
    const y = onSponson ? -H * 0.1 + (r() - 0.5) * H * 0.4 : (r() - 0.5) * H * 0.7;
    const z = onSponson ? L * 0.02 + (r() - 0.5) * L * 0.3 : -L * 0.1 + (r() - 0.5) * L * 0.7;
    p3.set(x, Math.round(y / (H * 0.12)) * H * 0.12, z);
    s3.set(L * 0.003, L * 0.004, L * (0.004 + r() * 0.012));
    m4.compose(p3, q, s3);
    win.setMatrixAt(i, m4);
  }
  hull.add(win);

  // ---- Running lights at the extremities.
  const lights: THREE.Sprite[] = [];
  const lp: [number, number, number, number][] = [
    [-W * 0.8, H * 0.3, -L * 0.1, 0xff4040], [W * 0.8, H * 0.3, -L * 0.1, 0x40ff80],
    [0, H * 2.7, bz + L * 0.02, 0xffffff], [0, H * 0.2, -L * 0.72, 0xffffff],
  ];
  for (const [x, y, z, c] of lp) {
    const sp = glowSprite(c, L * 0.03, 0.9);
    sp.position.set(x, y, z);
    sp.userData.phase = r() * 6.28;
    hull.add(sp);
    lights.push(sp);
  }
  root.userData.lights = lights;

  return { root, engines, length: L, seed: o.seed };
}

export function blinkLights(v: ShipVisual, t: number) {
  const lights = v.root.userData.lights as THREE.Sprite[] | undefined;
  lights?.forEach((sp) => { sp.material.opacity = Math.sin(t * 2.2 + sp.userData.phase) > 0.6 ? 1 : 0.05; });
}
