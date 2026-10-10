import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, SMAAEffect,
  ChromaticAberrationEffect, BlendFunction,
} from 'postprocessing';
import { makeSky, SUN_DIR, NEBULA_FOG } from './sky';
import { makeShip, makeRock, type ShipVisual } from './fleet';
import { makeCapital, blinkLights } from './capital';
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

interface Actor { v: ShipVisual; orbitR: number; orbitSpeed: number; phase: number; y: number; }
const wing: Actor[] = [];
let flagship: ShipVisual | null = null;
const enemies: Actor[] = [];
const rocks: THREE.Group[] = [];

async function build() {
  flagship = makeCapital({ length: 150, accent: 0xd2602e, engine: ENGINE_BLUE, seed: 7 });
  flagship.root.rotation.y = Math.PI * 0.12;
  scene.add(flagship.root);

  // Escort wing: small ships in a loose sphere around the flagship, slowly circling.
  const fighters = ['fighter_a', 'fighter_b', 'fighter_c'];
  for (let i = 0; i < 22; i++) {
    const v = await makeShip(fighters[i % 3], 7 + Math.random() * 5, ENGINE_BLUE, 1);
    wing.push({
      v, orbitR: 60 + Math.random() * 140, orbitSpeed: (0.02 + Math.random() * 0.04) * (Math.random() < 0.5 ? 1 : -1),
      phase: Math.random() * Math.PI * 2, y: (Math.random() - 0.5) * 70,
    });
    scene.add(v.root);
  }

  // Enemy line, far off to the sun side, so beams cross the frame.
  const kinds: [string, number][] = [['enemy_large', 55], ['enemy_small', 14], ['enemy_flying', 16]];
  for (let i = 0; i < 9; i++) {
    const [k, L] = kinds[i === 0 ? 0 : 1 + (i % 2)];
    const v = i === 0 ? makeCapital({ length: 130, accent: 0xb3242a, engine: ENGINE_RED, seed: 42 }) : await makeShip(k, L, ENGINE_RED, 1);
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

  if (flagship) {
    flagship.root.position.y = Math.sin(t * 0.25) * 2;
    flagship.root.rotation.z = Math.sin(t * 0.18) * 0.01;
    flagship.engines.forEach((e, i) => flickerEngine(e, t, flagship!.seed + i));
    blinkLights(flagship, t);
  }
  for (const a of wing) {
    const ang = a.phase + t * a.orbitSpeed;
    const x = Math.cos(ang) * a.orbitR, z = Math.sin(ang) * a.orbitR;
    a.v.root.position.set(x, a.y + Math.sin(t * 0.5 + a.phase) * 4, z);
    // face along the orbit tangent
    tmp.set(-Math.sin(ang) * a.orbitSpeed, 0, Math.cos(ang) * a.orbitSpeed).normalize();
    a.v.root.lookAt(a.v.root.position.clone().sub(tmp));
    a.v.root.rotateZ(Math.sin(t * 0.7 + a.phase) * 0.15);
    a.v.engines.forEach((e) => flickerEngine(e, t, a.v.seed));
  }
  for (const a of enemies) {
    const ang = a.phase + t * a.orbitSpeed;
    a.v.root.position.set(Math.cos(ang) * a.orbitR, a.y, Math.sin(ang) * a.orbitR);
    a.v.root.lookAt(0, a.y, 0);
    a.v.engines.forEach((e) => flickerEngine(e, t, a.v.seed));
    blinkLights(a.v, t);
  }
  for (const r of rocks) {
    const s = r.userData.spin as THREE.Vector3;
    r.rotation.x += s.x * dt; r.rotation.y += s.y * dt; r.rotation.z += s.z * dt;
  }

  // Exchange of fire: the fleet and the enemy line trade ion beams.
  if (t > nextBeam && flagship && enemies.length) {
    nextBeam = t + 0.12 + Math.random() * 0.5;
    const r = Math.random();
    if (r < 0.35) {
      const e = enemies[Math.floor(Math.random() * enemies.length)];
      const from = flagship.root.localToWorld(new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * 16, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 90));
      beams.fire(from, e.v.root.position.clone(), 0x8fa6ff, 0.9, 0.7);
    } else if (r < 0.75) {
      const w = wing[Math.floor(Math.random() * wing.length)];
      const e = enemies[Math.floor(Math.random() * enemies.length)];
      beams.fire(w.v.root.position.clone(), e.v.root.position.clone(), 0x9fb6ff, 0.35, 0.35);
    } else {
      const e = enemies[Math.floor(Math.random() * enemies.length)];
      const target = Math.random() < 0.3 ? flagship.root.position.clone() : wing[Math.floor(Math.random() * wing.length)].v.root.position.clone();
      beams.fire(e.v.root.position.clone(), target, 0xff8a5a, 0.4, 0.3);
    }
  }
  beams.update(performance.now() / 1000);

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
