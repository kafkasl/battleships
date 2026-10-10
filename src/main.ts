import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, SMAAEffect,
  ChromaticAberrationEffect, BlendFunction,
} from 'postprocessing';
import { makeSky, SUN_DIR, NEBULA_FOG } from './sky';
import { makeShip, makeRock, type ShipVisual } from './fleet';
import { makeCapital, blinkLights } from './capital';
import { Sim, makeShip as makeSimShip, type Ship } from './sim';
import { installConsole } from './console';
import { BeamSystem, flickerEngine, makeDust, makeGrid } from './fx';

// ---- Renderer / scene / camera ------------------------------------------

const renderer = new THREE.WebGLRenderer({
  powerPreference: 'high-performance', antialias: false, stencil: false, depth: false,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(NEBULA_FOG, 0.00075);

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.5, 20000);
camera.position.set(-150, 55, 170);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.045;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.8;
controls.minDistance = 15;
controls.maxDistance = 1800;
controls.screenSpacePanning = true;

// ---- Lights --------------------------------------------------------------

const sun = new THREE.DirectionalLight(0xffd3a0, 3.2);
sun.position.copy(SUN_DIR).multiplyScalar(1000);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x6a86ff, 1.1);
rim.position.copy(SUN_DIR).multiplyScalar(-1000).add(new THREE.Vector3(0, 400, 0));
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x9a4a3a, 0x1a0a10, 0.9));

const sky = makeSky();
// Bake the nebula into an environment map so hull metal picks up its colour.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  skyScene.add(sky);
  scene.environment = pmrem.fromScene(skyScene, 0.04).texture;
  scene.environmentIntensity = 0.55;
  skyScene.remove(sky);
  pmrem.dispose();
}
scene.add(sky);
scene.add(makeDust(2500, 900));

// Tactical grid on the battle plane. G toggles it.
const grid = makeGrid();
grid.visible = true;
scene.add(grid);
addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'g') grid.visible = !grid.visible; });

// ---- Post-processing -----------------------------------------------------

const composer = new EffectComposer(renderer, { multisampling: 0 });
composer.addPass(new RenderPass(scene, camera));
const bloom = new BloomEffect({
  intensity: 1.35, luminanceThreshold: 0.5, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.85,
});
const chroma = new ChromaticAberrationEffect({
  blendFunction: BlendFunction.NORMAL, offset: new THREE.Vector2(0.0009, 0.0006), radialModulation: true, modulationOffset: 0.4,
});
composer.addPass(new EffectPass(camera, bloom, new VignetteEffect({ darkness: 0.55, offset: 0.25 }), new SMAAEffect()));
composer.addPass(new EffectPass(camera, chroma));

// ---- Fleet ---------------------------------------------------------------

const ENGINE_BLUE = 0x6fa8ff;
const ENGINE_RED = 0xff7a4a;
const beams = new BeamSystem(scene);

// ---- Simulation ----------------------------------------------------------

const sim = new Sim();
const player = sim.add(makeSimShip({ id: 'vigilant', name: 'Vigilant', type: 'capital', faction: 'player', heading: 20, desiredHeading: 20 }));
const foe = sim.add(makeSimShip({ id: 'ravager', name: 'Ravager', type: 'capital', faction: 'enemy',
  pos: { x: 260, y: 10, z: -300 }, heading: 200, desiredHeading: 200, desiredAltitude: 10, speed: 0.3, desiredSpeed: 0.3 }));
// The fleet you command. Names are chosen to be easy to say out loud.
const kestrel = sim.add(makeSimShip({ id: 'kestrel', name: 'Kestrel', type: 'frigate', faction: 'player', color: '#7fd3ff',
  pos: { x: -120, y: 6, z: 40 }, heading: 20, desiredHeading: 20, desiredAltitude: 6 }));
const heron = sim.add(makeSimShip({ id: 'heron', name: 'Heron', type: 'frigate', faction: 'player', color: '#9fffd0',
  pos: { x: 120, y: 6, z: 40 }, heading: 20, desiredHeading: 20, desiredAltitude: 6 }));
const frigates = [kestrel, heron];
const alphaColors = ['#c9b3ff', '#ffb3d9', '#ffe29a'];
const alphas = [1, 2, 3].map((n) => sim.add(makeSimShip({
  id: `alpha${n}`, name: `Alpha ${n}`, type: 'fighter', faction: 'player', color: alphaColors[n - 1],
  pos: { x: (n - 2) * 50, y: 14, z: 110 }, heading: 20, desiredHeading: 20, desiredAltitude: 14,
})));
player.color = '#ffd59a';
foe.color = '#ff6a5a';
const fleet = [player, ...frigates, ...alphas];
const visuals = new Map<string, ShipVisual>();

/** What Jev may address. Labels resolve to ships; descriptions teach Jev every way to say them. */
function addressing() {
  const roster: Record<string, string> = {
    flagship: 'the Vigilant, our capital ship, the flagship, the carrier. Also the default when the order names no particular ship',
    kestrel: 'the frigate Kestrel',
    heron: 'the frigate Heron',
    frigates: 'both frigates: the frigates, the escorts',
    alpha1: 'the fighter Alpha 1, alpha one',
    alpha2: 'the fighter Alpha 2, alpha two',
    alpha3: 'the fighter Alpha 3, alpha three',
    fighters: 'all three fighters: the fighters, the wing, alpha wing',
    enemy: 'the enemy ship Ravager, the enemy capital ship, them',
  };
  const resolve = (label: string): Ship[] => {
    if (label === 'flagship') return [player];
    if (label === 'frigates') return frigates;
    if (label === 'fighters') return alphas;
    if (label === 'all') return fleet;
    if (label === 'enemy') return [foe];
    const s = sim.ships.get(label);
    return s ? [s] : [];
  };
  return { roster, resolve };
}

// Ships flash their grid marker when they take an order.
const flash = new Map<string, number>();
installConsole(sim, () => player, addressing, (s) => flash.set(s.id, performance.now()));

// Ship card: hover previews a ship, click pins it. Defaults to the flagship.
let pinned: Ship = player;
let hovered: Ship | null = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let mouseMoved = false;
renderer.domElement.addEventListener('pointermove', (e) => { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); mouseMoved = true; });
renderer.domElement.addEventListener('pointerdown', () => { mouseMoved = false; });
renderer.domElement.addEventListener('pointerup', (e) => { if (e.button === 0 && !mouseMoved && hovered) pinned = hovered; });
function pick(): Ship | null {
  raycaster.setFromCamera(mouse, camera);
  const roots = [...visuals.entries()].map(([id, v]) => { v.root.userData.shipId = id; return v.root; });
  const hits = raycaster.intersectObjects(roots, true);
  for (const h of hits) {
    let o: THREE.Object3D | null = h.object;
    while (o && !o.userData.shipId) o = o.parent;
    if (o) return sim.ships.get(o.userData.shipId as string) ?? null;
  }
  return null;
}
const inputsPanel = document.getElementById('inputs')!;

/** Thin vertical line from a ship to its shadow on the battle plane, Homeworld style. */
function makeDropLine(): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(5, 6, 32), new THREE.MeshBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  line.add(ring);
  return line;
}
const dropLines = new Map<string, THREE.Line>();

function syncVisual(s: Ship) {
  const v = visuals.get(s.id);
  if (!v) return;
  v.root.position.set(s.pos.x, s.pos.y, s.pos.z);
  v.root.rotation.set(0, -s.heading * Math.PI / 180, 0);
  v.root.rotateZ(THREE.MathUtils.clamp(s.turning * 0.03, -0.25, 0.25));   // bank into turns
  v.engines.forEach((e) => { const k = 0.35 + 0.65 * s.speed; (e.children[1] as THREE.Sprite).scale.setScalar(e.userData.base * 2.4 * k); });
  let d = dropLines.get(s.id);
  if (!d) {
    d = makeDropLine(); dropLines.set(s.id, d); scene.add(d);
    (d.material as THREE.LineBasicMaterial).color.set(s.color);
    ((d.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(s.color);
  }
  const since = (performance.now() - (flash.get(s.id) ?? -1e9)) / 1000;
  const ringMat = (d.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
  ringMat.opacity = since < 1.2 ? 0.5 + 0.5 * Math.abs(Math.sin(since * 12)) * (1 - since / 1.2) : s === pinned ? 0.9 : 0.5;
  const pos = d.geometry.getAttribute('position') as THREE.BufferAttribute;
  pos.setXYZ(0, s.pos.x, 0, s.pos.z); pos.setXYZ(1, s.pos.x, s.pos.y, s.pos.z); pos.needsUpdate = true;
  (d.children[0] as THREE.Mesh).position.set(s.pos.x, 0.5, s.pos.z);
  (d.children[0] as THREE.Mesh).scale.setScalar((s.type === 'capital' ? 2 : s.type === 'frigate' ? 1.2 : 0.8) * (since < 1.2 ? 1 + 0.6 * (1 - since / 1.2) : 1));
  d.visible = grid.visible;
}

interface Actor { v: ShipVisual; orbitR: number; orbitSpeed: number; phase: number; y: number; }
let flagship: ShipVisual | null = null;
const enemies: Actor[] = [];
const rocks: THREE.Group[] = [];

async function build() {
  flagship = makeCapital({ length: 150, accent: 0xd2602e, engine: ENGINE_BLUE, seed: 7 });
  visuals.set(player.id, flagship);
  scene.add(flagship.root);

  for (const a of alphas) {
    const v = await makeShip('fighter_a', 12, ENGINE_BLUE, 1);
    visuals.set(a.id, v);
    scene.add(v.root);
  }
  for (const [i, f] of frigates.entries()) {
    const v = makeCapital({ length: 55, accent: 0xd2602e, engine: ENGINE_BLUE, seed: 11 + i });
    visuals.set(f.id, v);
    scene.add(v.root);
  }

  // Enemy line, far off to the sun side, so beams cross the frame.
  const kinds: [string, number][] = [['enemy_large', 55], ['enemy_small', 14], ['enemy_flying', 16]];
  for (let i = 0; i < 9; i++) {
    const [k, L] = kinds[i === 0 ? 0 : 1 + (i % 2)];
    if (i === 0) {
      const v = makeCapital({ length: 130, accent: 0xb3242a, engine: ENGINE_RED, seed: 42 });
      visuals.set(foe.id, v);
      scene.add(v.root);
      continue;
    }
    const v = await makeShip(k, L, ENGINE_RED, 1);
    const a = { v, orbitR: 300 + Math.random() * 120, orbitSpeed: 0.006 + Math.random() * 0.01, phase: -0.35 + (Math.random() - 0.5) * 0.9, y: (Math.random() - 0.5) * 50 };
    enemies.push(a);
    scene.add(v.root);
  }

  // Asteroids drifting in the fog for depth.
  const rockNames = ['rock_a', 'rock_b', 'rock_c'];
  for (let i = 0; i < 40; i++) {
    const r = await makeRock(rockNames[i % 3], 10 + Math.random() * 60);
    r.position.copy(new THREE.Vector3().randomDirection().multiplyScalar(250 + Math.random() * 900));
    r.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    r.userData.spin = new THREE.Vector3().randomDirection().multiplyScalar(0.02 + Math.random() * 0.05);
    rocks.push(r);
    scene.add(r);
  }
  document.getElementById('loading')?.remove();
}

// ---- Loop ----------------------------------------------------------------

const clock = new THREE.Clock();
let nextBeam = 0;
const tmp = new THREE.Vector3();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  sim.tick(dt);
  for (const s of sim.ships.values()) syncVisual(s);
  for (const v of visuals.values()) { v.engines.forEach((e, i) => flickerEngine(e, t, v.seed + i)); blinkLights(v, t); }
  hovered = pick();
  const card = hovered ?? pinned;
  document.body.style.cursor = hovered ? 'pointer' : '';
  inputsPanel.style.borderColor = card.color;
  inputsPanel.innerHTML = `<b style="color:${card.color}">${card.name}</b> <span class="cls">${card.type}${card === hovered && card !== pinned ? ' · click to pin' : ''}</span>\n` +
    `<i>${card.lastOrder}</i>\n\n` +
    `speed     ${Math.round(card.speed * 100)}%  →  ${Math.round(card.desiredSpeed * 100)}%\n` +
    `heading   ${Math.round(card.heading).toString().padStart(3, '0')}  →  ${Math.round(card.desiredHeading).toString().padStart(3, '0')}\n` +
    `altitude  ${Math.round(card.pos.y)}  →  ${Math.round(card.desiredAltitude)}\n` +
    `hull      ${card.hull}\n` +
    `crew      ${Object.entries(card.stations).map(([k, v]) => `${k === 'sensoria' ? 'sensors' : k} ${v}`).join(' · ')}  (${card.crew} aboard)\n` +
    `contacts  ${card.contacts.length}`;
  // The enemy capital ship patrols in a slow circle so there is always something to shoot at.
  if (Math.floor(t / 20) !== Math.floor((t - dt) / 20)) foe.desiredHeading = (foe.desiredHeading + 60) % 360;

  for (const a of enemies) {
    const ang = a.phase + t * a.orbitSpeed;
    a.v.root.position.set(foe.pos.x + Math.cos(ang) * a.orbitR * 0.3, foe.pos.y + a.y, foe.pos.z + Math.sin(ang) * a.orbitR * 0.3);
    a.v.root.lookAt(player.pos.x, player.pos.y, player.pos.z);
    a.v.engines.forEach((e) => flickerEngine(e, t, a.v.seed));
  }
  for (const r of rocks) {
    const s = r.userData.spin as THREE.Vector3;
    r.rotation.x += s.x * dt; r.rotation.y += s.y * dt; r.rotation.z += s.z * dt;
  }

  // Exchange of fire: the fleet and the enemy line trade ion beams.
  const foeVisual = visuals.get(foe.id);
  if (t > nextBeam && flagship && foeVisual && enemies.length) {
    nextBeam = t + 0.12 + Math.random() * 0.5;
    const r = Math.random();
    const enemyPos = () => (Math.random() < 0.4 ? foeVisual : enemies[Math.floor(Math.random() * enemies.length)].v).root.position.clone();
    if (r < 0.35) {
      const from = flagship.root.localToWorld(new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * 16, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 90));
      beams.fire(from, enemyPos(), 0x8fa6ff, 0.9, 0.7);
    } else if (r < 0.7) {
      const w = visuals.get(fleet[1 + Math.floor(Math.random() * (fleet.length - 1))].id);
      if (w) beams.fire(w.root.position.clone(), enemyPos(), 0x9fb6ff, 0.35, 0.35);
    } else {
      const from = Math.random() < 0.5
        ? foeVisual.root.localToWorld(new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 80))
        : enemies[Math.floor(Math.random() * enemies.length)].v.root.position.clone();
      const target = (Math.random() < 0.4 ? flagship : visuals.get(fleet[1 + Math.floor(Math.random() * (fleet.length - 1))].id) ?? flagship).root.position.clone();
      beams.fire(from, target, 0xff8a5a, 0.5, 0.35);
    }
  }
  beams.update(performance.now() / 1000);

  // Camera stays glued to the flagship: move the orbit target (and the camera with it) by its motion.
  tmp.set(player.pos.x, player.pos.y, player.pos.z).sub(controls.target);
  controls.target.add(tmp); camera.position.add(tmp);
  controls.update();
  (grid.material as THREE.ShaderMaterial).uniforms.uCenter.value.copy(controls.target);
  composer.render(dt);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

build();
tick();
