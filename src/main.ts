import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, SMAAEffect,
  ChromaticAberrationEffect, BlendFunction,
} from 'postprocessing';
import { makeSky, SUN_DIR, NEBULA_FOG } from './sky';
import { makeShip, makeRock, type ShipVisual } from './fleet';
import { makeCapital, blinkLights } from './capital';
import { Sim, makeShip as makeSimShip, type Ship, SHIP_TYPES, BLIND_CONE, ARENA } from './sim';
import { installConsole } from './console';
import { runBehaviours, behaviours, ENGAGE } from './behaviours';
void ENGAGE; // registered on import
import { restore } from './academy';
import { BeamSystem, ExplosionSystem, flickerEngine, makeDust, makeGrid } from './fx';

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
camera.position.set(-220, 90, 820);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.045;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.8;
controls.minDistance = 15;
controls.maxDistance = 1800;
controls.screenSpacePanning = true;
controls.target.set(-40, 0, 520);
let followCam = false;

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
// Arena outline: the square ships are kept inside. Shown and hidden with the grid.
const arenaEdge = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([[-ARENA, -ARENA], [ARENA, -ARENA], [ARENA, ARENA], [-ARENA, ARENA], [-ARENA, -ARENA]].map(([x, z]) => new THREE.Vector3(x, 0.4, z))),
  new THREE.LineBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
scene.add(arenaEdge);
let panX = 0, panZ = 0;
const mousePx = { x: innerWidth / 2, y: innerHeight / 2 };
let mouseIn = false;
addEventListener('pointermove', (e) => { mousePx.x = e.clientX; mousePx.y = e.clientY; mouseIn = true; });
document.addEventListener('mouseleave', () => { mouseIn = false; });
addEventListener('blur', () => { mouseIn = false; });
const panKeys: Record<string, [number, number]> = { w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
const held = new Set<string>();
const recomputePan = () => { panX = 0; panZ = 0; for (const k of held) { const v = panKeys[k]; if (v) { panX += v[0]; panZ += v[1]; } } };
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'g') grid.visible = !grid.visible;
  if (k === 'l') followCam = !followCam;
  if (k in panKeys && k !== 'd') { held.add(k); recomputePan(); e.preventDefault(); }
  if (k === 'd' && e.shiftKey) { held.add('d'); recomputePan(); }
});
addEventListener('keyup', (e) => { held.delete(e.key.toLowerCase()); recomputePan(); });

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
const explosions = new ExplosionSystem(scene);

// ---- Simulation ----------------------------------------------------------

const sim = new Sim();
// Fleets face each other, staggered just enough sideways that a straight charge does not pass through the enemy.
const player = sim.add(makeSimShip({ id: 'mother', name: 'Mother', type: 'capital', faction: 'player', pos: { x: -40, y: 0, z: 560 } }));
const foe = sim.add(makeSimShip({ id: 'dragon', name: 'Dragon', type: 'capital', faction: 'enemy', color: '#ff6a5a',
  pos: { x: 40, y: 10, z: -560 }, heading: 180, desiredHeading: 180, desiredAltitude: 10, weaponsFree: true, hull: 300 }));
const raiders = [1, 2, 3, 4].map((n) => sim.add(makeSimShip({
  id: `drone${n}`, name: `Drone ${n}`, type: 'fighter', faction: 'enemy', color: '#ff8a7a', weaponsFree: true, hull: 20,
  pos: { x: 40 + (n - 2.5) * 70, y: 10 + (n % 2) * 14, z: -460 }, heading: 180, desiredHeading: 180, desiredAltitude: 10 + (n % 2) * 14,
})));
const hostiles = [foe, ...raiders];
// The fleet you command. Names are chosen to be easy to say out loud.
const red = sim.add(makeSimShip({ id: 'red', name: 'Red', type: 'frigate', faction: 'player', color: '#7fd3ff',
  pos: { x: -170, y: 6, z: 600 }, desiredAltitude: 6 }));
const blue = sim.add(makeSimShip({ id: 'blue', name: 'Blue', type: 'frigate', faction: 'player', color: '#9fffd0',
  pos: { x: 90, y: 6, z: 600 }, desiredAltitude: 6 }));
const frigates = [red, blue];
const alphaColors = ['#c9b3ff', '#ffb3d9', '#ffe29a'];
const alphas = [1, 2, 3].map((n) => sim.add(makeSimShip({
  id: `eagle${n}`, name: `Eagle ${n}`, type: 'fighter', faction: 'player', color: alphaColors[n - 1],
  pos: { x: -40 + (n - 2) * 50, y: 14, z: 470 }, desiredAltitude: 14,
})));
player.color = '#ffd59a';
foe.color = '#ff6a5a';
const fleet = [player, ...frigates, ...alphas];
const visuals = new Map<string, ShipVisual>();

/** What Jev may address. Labels resolve to ships; descriptions teach Jev every way to say them. */
function addressing() {
  const roster: Record<string, string> = {
    flagship: 'Mother, our capital ship, the mothership, the flagship, the big ship. Also the default when the order names no particular ship',
    red: 'the frigate Red',
    blue: 'the frigate Blue',
    frigates: 'both frigates: the frigates, Red and Blue, the escorts',
    eagle1: 'the fighter Eagle 1, eagle one',
    eagle2: 'the fighter Eagle 2, eagle two',
    eagle3: 'the fighter Eagle 3, eagle three',
    fighters: 'all three fighters: the fighters, the eagles, the wing',
    enemy: 'the enemy ship Dragon, the enemy capital ship, the drones, them',
  };
  const alive = (ships: Ship[]) => ships.filter((s) => sim.ships.has(s.id));
  const resolve = (label: string): Ship[] => {
    if (label === 'flagship') return alive([player]);
    if (label === 'frigates') return alive(frigates);
    if (label === 'fighters') return alive(alphas);
    if (label === 'all') return alive(fleet);
    if (label === 'enemy') return alive([foe]);
    const s = sim.ships.get(label);
    return s ? [s] : [];
  };
  return { roster, resolve };
}

// Ships flash their grid marker when they take an order.
const flash = new Map<string, number>();
// ---- Match: one run until Ravager or Vigilant dies, or the clock runs out. --------------------

const MATCH_SECONDS = 180;
const match = { started: 0, over: false, kills: 0, losses: 0, outcome: '' };
const ui = installConsole(sim, () => player, addressing,
  (s) => { flash.set(s.id, performance.now()); if (!match.started) match.started = performance.now(); },
  (name) => { ui.line('info', null, `Manoeuvre "${name}" added to the fleet's repertoire.`); });
for (const b of restore()) ui.line('info', null, `Remembered manoeuvre "${b.name}".`);

interface Run { name: string; outcome: string; kills: number; losses: number; seconds: number; }
const loadRuns = (): Run[] => { try { return JSON.parse(localStorage.getItem('runs') ?? '[]'); } catch { return []; } };
const score = (r: Run) => r.kills * 1000 - r.losses * 300 - r.seconds + (r.outcome === 'victory' ? 5000 : 0);

function endMatch(outcome: string) {
  if (match.over) return;
  match.over = true; match.outcome = outcome;
  const seconds = Math.round((performance.now() - match.started) / 1000);
  const el = document.getElementById('results')!;
  el.style.display = '';
  (el.querySelector('h1') as HTMLElement).textContent = outcome === 'victory' ? 'Dragon destroyed' : outcome === 'defeat' ? 'Mother lost' : 'Time is up';
  (el.querySelector('.stats') as HTMLElement).textContent = `${seconds}s · ${match.kills} enemy ships destroyed · ${match.losses} ships lost`;
  const nameInput = el.querySelector('input') as HTMLInputElement;
  const renderBoard = (runs: Run[], mine?: Run) => {
    const sorted = [...runs].sort((a, b) => score(b) - score(a));
    (el.querySelector('.board') as HTMLElement).innerHTML = sorted.slice(0, 8).map((r, i) =>
      `<div class="row${r === mine ? ' mine' : ''}"><span>${i + 1}</span><span>${r.name}</span><span>${r.outcome}</span><span>${r.kills} kills</span><span>${r.losses} lost</span><span>${r.seconds}s</span></div>`).join('');
  };
  renderBoard(loadRuns());
  const save = () => {
    const runs = loadRuns();
    const mine: Run = { name: (nameInput.value.trim() || 'Captain').slice(0, 16), outcome, kills: match.kills, losses: match.losses, seconds };
    runs.push(mine);
    try { localStorage.setItem('runs', JSON.stringify(runs)); } catch { /* ignore */ }
    renderBoard(runs, mine);
    nameInput.disabled = true;
    (el.querySelector('#save') as HTMLButtonElement).disabled = true;
  };
  (el.querySelector('#save') as HTMLButtonElement).onclick = save;
  nameInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') save(); };
  (el.querySelector('#again') as HTMLButtonElement).onclick = () => location.reload();
  setTimeout(() => nameInput.focus(), 50);
}

const tray = document.getElementById('tray')!;
function updateTray() {
  if (!behaviours.size) { tray.style.display = 'none'; return; }
  tray.style.display = '';
  tray.innerHTML = '<b>Manoeuvres</b>' + [...behaviours.values()].map((b) => {
    const n = [...sim.ships.values()].filter((s) => s.behaviour === b.id && s.faction === 'player').length;
    return `<div class="man"><span class="name">${b.name}</span><span class="n">${n ? n + ' ship' + (n > 1 ? 's' : '') : 'idle'}</span></div>`;
  }).join('');
}

// Ship card: hover previews a ship, click pins it. Defaults to the flagship.
let pinned: Ship = player;
let hovered: Ship | null = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let mouseMoved = false;
renderer.domElement.addEventListener('pointermove', (e) => { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); mouseMoved = true; });
renderer.domElement.addEventListener('pointerdown', () => { mouseMoved = false; });
renderer.domElement.addEventListener('pointerup', (e) => { if (e.button === 0 && !mouseMoved && hovered) pinned = hovered; });
// One bar per ship, projected onto the screen above it.
const barsRoot = document.getElementById('bars')!;
const bars = new Map<string, HTMLDivElement>();
const proj = new THREE.Vector3();
function updateHullBars() {
  for (const [id, el] of bars) if (!sim.ships.has(id)) { el.remove(); bars.delete(id); }
  for (const s of sim.ships.values()) {
    const v = visuals.get(s.id);
    if (!v) continue;
    let el = bars.get(s.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'bar';
      el.innerHTML = `<span class="name"></span><div class="track"><div class="fill"></div></div>`;
      (el.querySelector('.name') as HTMLSpanElement).textContent = s.name;
      (el.querySelector('.fill') as HTMLDivElement).style.background = s.color;
      el.style.color = s.color;
      barsRoot.appendChild(el);
      bars.set(s.id, el);
    }
    const L = SHIP_TYPES[s.type].length;
    proj.set(s.pos.x, s.pos.y + L * 0.35 + 6, s.pos.z).project(camera);
    const behind = proj.z > 1;
    el.style.display = behind ? 'none' : '';
    if (behind) continue;
    el.style.left = `${((proj.x + 1) / 2) * innerWidth}px`;
    el.style.top = `${((1 - proj.y) / 2) * innerHeight}px`;
    (el.querySelector('.fill') as HTMLDivElement).style.width = `${Math.max(0, (s.hull / s.maxHull) * 100)}%`;
    el.classList.toggle('hot', s.weaponsFree);
    el.classList.toggle('man', !!s.behaviour);
  }
}

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

/**
 * Thin vertical line from a ship to its shadow on the battle plane, Homeworld style, with a marker
 * ring, and a faint arc at weapon range showing where the guns can reach (the stern cone is open).
 */
function makeDropLine(range: number): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(5, 6, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  // Arc: RingGeometry's theta runs counter-clockwise from +X in its own plane. Rotated flat onto the
  // grid and spun by the heading, a start of (blind/2 + 90°) with length (360 - blind) leaves the stern open.
  // In the ring's own plane, theta 90° is the bow (world -Z after the flat rotation) and 270° the stern.
  const blind = (BLIND_CONE * Math.PI) / 180;
  const stern = Math.PI * 1.5;
  const arc = new THREE.Mesh(new THREE.RingGeometry(range - 1.2, range, 96, 1, stern + blind / 2, Math.PI * 2 - blind),
    new THREE.MeshBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  arc.rotation.x = -Math.PI / 2;
  // The two edges of the blind sector, so the gap reads as "cannot fire here" rather than a missing piece.
  const edges = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([-1, 1].flatMap((sgn) => {
    const th = stern + sgn * blind / 2;
    return [new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(th) * range, Math.sin(th) * range, 0)];
  })), new THREE.LineBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
  arc.add(edges);
  line.add(ring, arc);
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
    d = makeDropLine(SHIP_TYPES[s.type].weaponRange); dropLines.set(s.id, d); scene.add(d);
    (d.material as THREE.LineBasicMaterial).color.set(s.color);
    ((d.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(s.color);
    ((d.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(s.color);
  }
  const arc = d.children[1] as THREE.Mesh;
  arc.position.set(s.pos.x, 0.3, s.pos.z);
  arc.rotation.z = -s.heading * Math.PI / 180;
  (arc.material as THREE.MeshBasicMaterial).opacity = s.weaponsFree ? 0.3 : 0.1;
  ((arc.children[0] as THREE.LineSegments).material as THREE.LineBasicMaterial).color.set(s.color);
  const since = (performance.now() - (flash.get(s.id) ?? -1e9)) / 1000;
  const ringMat = (d.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
  ringMat.opacity = since < 1.2 ? 0.5 + 0.5 * Math.abs(Math.sin(since * 12)) * (1 - since / 1.2) : s === pinned ? 0.9 : 0.5;
  const pos = d.geometry.getAttribute('position') as THREE.BufferAttribute;
  pos.setXYZ(0, s.pos.x, 0, s.pos.z); pos.setXYZ(1, s.pos.x, s.pos.y, s.pos.z); pos.needsUpdate = true;
  (d.children[0] as THREE.Mesh).position.set(s.pos.x, 0.5, s.pos.z);
  (d.children[0] as THREE.Mesh).scale.setScalar((s.type === 'capital' ? 2 : s.type === 'frigate' ? 1.2 : 0.8) * (since < 1.2 ? 1 + 0.6 * (1 - since / 1.2) : 1));
  d.visible = grid.visible;
}

let flagship: ShipVisual | null = null;
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

  // The enemy line, off toward the sun.
  {
    const v = makeCapital({ length: 130, accent: 0xb3242a, engine: ENGINE_RED, seed: 42 });
    visuals.set(foe.id, v);
    scene.add(v.root);
  }
  for (const r of raiders) {
    const v = await makeShip('enemy_small', 12, ENGINE_RED, 1);
    visuals.set(r.id, v);
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
const tmp = new THREE.Vector3();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  runBehaviours(sim, dt, (s, e) => { ui.line('refused', s, `I'm too dumb for that, captain. (${String(e)})`); });
  sim.tick(dt);
  for (const s of sim.ships.values()) syncVisual(s);
  for (const v of visuals.values()) { v.engines.forEach((e, i) => flickerEngine(e, t, v.seed + i)); blinkLights(v, t); }
  hovered = pick();
  if (!sim.ships.has(pinned.id)) pinned = player;
  const card = hovered ?? pinned;
  document.body.style.cursor = hovered ? 'pointer' : '';
  inputsPanel.style.borderColor = card.color;
  inputsPanel.innerHTML = `<b style="color:${card.color}">${card.name}</b> <span class="cls">${card.type}${card === hovered && card !== pinned ? ' · click to pin' : ''}</span>\n` +
    `<i>${card.lastOrder}</i>${card.behaviour ? ` <span class="cls">· running ${card.behaviour}</span>` : ''}\n\n` +
    `speed     ${Math.round(card.speed * 100)}%  →  ${Math.round(card.desiredSpeed * 100)}%\n` +
    `heading   ${Math.round(card.heading).toString().padStart(3, '0')}  →  ${Math.round(card.desiredHeading).toString().padStart(3, '0')}\n` +
    `altitude  ${Math.round(card.pos.y)}  →  ${Math.round(card.desiredAltitude)}\n` +
    `hull      ${Math.round(card.hull)} / ${card.maxHull}   ${card.weaponsFree ? 'weapons free' : 'holding fire'}\n` +
    `crew      ${Object.entries(card.stations).map(([k, v]) => `${k === 'sensoria' ? 'sensors' : k} ${v}`).join(' · ')}  (${card.crew} aboard)\n` +
    `contacts  ${card.contacts.length}`;
  // The enemy capital ship patrols in a slow circle so there is always something to shoot at.
  if (Math.floor(t / 20) !== Math.floor((t - dt) / 20)) foe.desiredHeading = (foe.desiredHeading + 60) % 360;

  for (const r of rocks) {
    const s = r.userData.spin as THREE.Vector3;
    r.rotation.x += s.x * dt; r.rotation.y += s.y * dt; r.rotation.z += s.z * dt;
  }

  // Combat visuals come from sim events: a travelling beam per shot, an explosion per death.
  for (const ev of sim.events) {
    if (ev.type === 'shot') {
      const from = visuals.get(ev.from), to = visuals.get(ev.to), shooter = sim.ships.get(ev.from);
      if (!from || !to || !shooter) continue;
      const L = SHIP_TYPES[shooter.type].length;
      const muzzle = from.root.localToWorld(new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * L * 0.1, (Math.random() - 0.5) * L * 0.05, (Math.random() - 0.5) * L * 0.6));
      const hostile = shooter.faction === 'enemy';
      beams.fire(muzzle, to.root.position.clone(), hostile ? 0xff8a5a : 0x8fa6ff, L * 0.006 + 0.25, 0.45);
    } else {
      const v = visuals.get(ev.id);
      if (v) { scene.remove(v.root); visuals.delete(ev.id); }
      const d = dropLines.get(ev.id);
      if (d) { scene.remove(d); dropLines.delete(ev.id); }
      explosions.spawn(new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z), ev.length);
      if (pinned.id === ev.id) pinned = player;
      if (hostiles.some((h) => h.id === ev.id)) match.kills++; else match.losses++;
      if (ev.id === foe.id) endMatch('victory');
      if (ev.id === player.id) endMatch('defeat');
    }
  }
  sim.events.length = 0;
  explosions.update(performance.now() / 1000, dt);
  // Enemy doctrine for now: hold position, keep the guns on the nearest of ours.
  for (const h of hostiles) {
    if (!sim.ships.has(h.id)) continue;
    let near: Ship | null = null, nd = Infinity;
    for (const f of fleet) { if (!sim.ships.has(f.id)) continue; const dd = Math.hypot(f.pos.x - h.pos.x, f.pos.z - h.pos.z); if (dd < nd) { nd = dd; near = f; } }
    if (near) h.desiredHeading = (Math.atan2(near.pos.x - h.pos.x, -(near.pos.z - h.pos.z)) * 180) / Math.PI;
  }
  updateHullBars();
  updateTray();
  const clockEl = document.getElementById('clock')!;
  if (match.started && !match.over) {
    const left = Math.max(0, MATCH_SECONDS - (performance.now() - match.started) / 1000);
    clockEl.textContent = `${Math.floor(left / 60)}:${Math.floor(left % 60).toString().padStart(2, '0')}`;
    if (left <= 0) endMatch('timeout');
  } else if (!match.started) clockEl.textContent = 'give an order to begin';
  beams.update(performance.now() / 1000);

  // Camera lock (L): the orbit target rides along with the pinned ship. Otherwise the camera is free.
  if (followCam && sim.ships.has(pinned.id)) {
    tmp.set(pinned.pos.x, pinned.pos.y, pinned.pos.z).sub(controls.target);
    controls.target.add(tmp); camera.position.add(tmp);
  }
  // WASD / arrows pan across the battle plane, relative to the view. So does the mouse at a screen edge.
  let ex = 0, ez = 0;
  if (mouseIn && !match.over) {
    const EDGE = 28;
    if (mousePx.x < EDGE) ex = -1; else if (mousePx.x > innerWidth - EDGE) ex = 1;
    if (mousePx.y < EDGE) ez = 1; else if (mousePx.y > innerHeight - EDGE) ez = -1;
  }
  const px = panX + ex, pz = panZ + ez;
  if (px || pz) {
    const speed = controls.getDistance() * 0.8 * dt;
    const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    tmp.copy(fwd).multiplyScalar(pz * speed).addScaledVector(right, px * speed);
    controls.target.add(tmp); camera.position.add(tmp);
  }
  controls.update();
  (grid.material as THREE.ShaderMaterial).uniforms.uCenter.value.copy(controls.target);
  arenaEdge.visible = grid.visible;
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
