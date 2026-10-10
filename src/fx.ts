import * as THREE from 'three';

let _glow: THREE.Texture | null = null;
/** Soft radial gradient, the workhorse texture for glows, stars, sprites. */
export function glowTexture(): THREE.Texture {
  if (_glow) return _glow;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const grd = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, s, s);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}

export function glowSprite(color: THREE.ColorRepresentation, size: number, opacity = 1): THREE.Sprite {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  sp.scale.setScalar(size);
  return sp;
}

/** Engine glow: a bright core sprite, a wide halo, and a point light that tints the hull. */
export function engineGlow(color: THREE.ColorRepresentation, size: number): THREE.Group {
  const g = new THREE.Group();
  const core = glowSprite(0xffffff, size * 0.6);
  const halo = glowSprite(color, size * 2.4, 0.8);
  const light = new THREE.PointLight(color, size * 6, size * 14, 1.6);
  g.add(core, halo, light);
  g.userData.base = size;
  return g;
}

export function flickerEngine(g: THREE.Group, t: number, seed: number) {
  const f = 0.9 + 0.1 * Math.sin(t * 23 + seed) * Math.sin(t * 7.3 + seed * 2);
  const base = g.userData.base as number;
  (g.children[0] as THREE.Sprite).scale.setScalar(base * 0.6 * f);
  (g.children[1] as THREE.Sprite).scale.setScalar(base * 2.4 * (0.95 + 0.05 * f));
}

// ---- Beams -------------------------------------------------------------

const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
beamGeo.rotateX(Math.PI / 2); // along +Z

export interface Beam {
  group: THREE.Group; born: number; life: number; len: number;
  core: THREE.Mesh; halo: THREE.Mesh; muzzle: THREE.Sprite; impact: THREE.Sprite;
}

/**
 * Beams travel: the bolt grows out of the muzzle, races to the target, and only then does the
 * impact flash appear. That is what makes the direction of fire readable at a glance.
 */
export class BeamSystem {
  beams: Beam[] = [];
  constructor(private scene: THREE.Scene) {}

  fire(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation, width = 0.6, life = 0.5) {
    const g = new THREE.Group();
    const len = to.distanceTo(from);
    const core = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    const halo = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    core.scale.set(width, width, 0.001);
    halo.scale.set(width * 4, width * 4, 0.001);
    // Group origin sits at the muzzle, +Z points at the target; bolt meshes slide along +Z.
    g.position.copy(from);
    g.lookAt(to);
    const muzzle = glowSprite(color, width * 40);
    const impact = glowSprite(0xfff1d6, width * 30, 0);
    impact.position.set(0, 0, len);
    g.add(core, halo, muzzle, impact);
    this.scene.add(g);
    this.beams.push({ group: g, born: performance.now() / 1000, life, len, core, halo, muzzle, impact });
  }

  update(now: number) {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      const a = (now - b.born) / b.life;
      if (a >= 1) { this.scene.remove(b.group); this.beams.splice(i, 1); continue; }
      // Bolt: head races from 0 to len during the first 45%, tail follows during the next 35%.
      const head = Math.min(1, a / 0.45) * b.len;
      const tail = Math.max(0, (a - 0.35) / 0.4) * b.len;
      const seg = Math.max(0.001, head - tail);
      b.core.scale.z = seg; b.halo.scale.z = seg;
      b.core.position.z = tail + seg / 2; b.halo.position.z = tail + seg / 2;
      const fade = a > 0.8 ? 1 - (a - 0.8) / 0.2 : 1;
      (b.core.material as THREE.MeshBasicMaterial).opacity = fade;
      (b.halo.material as THREE.MeshBasicMaterial).opacity = 0.35 * fade;
      b.muzzle.material.opacity = Math.max(0, 1 - a / 0.25);
      const hit = a < 0.45 ? 0 : 1 - (a - 0.45) / 0.55;
      b.impact.material.opacity = hit;
      b.impact.scale.setScalar(b.impact.userData.base ?? (b.impact.userData.base = b.impact.scale.x));
      b.impact.scale.multiplyScalar(0.6 + 0.8 * (1 - hit));
    }
  }
}

/** Slow-drifting dust motes around the fleet; gives the camera parallax and the fog something to catch. */
export function makeDust(count: number, radius: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random()) * radius);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.6, map: glowTexture(), color: 0xffc9a0, transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

// ---- Tactical grid ------------------------------------------------------

/** Flat holographic grid on the y=0 battle plane, fading with distance from its centre. Toggle with G. */
export function makeGrid(size = 4000): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uColor: { value: new THREE.Color(0x5fc8ff) }, uCenter: { value: new THREE.Vector3() }, uFade: { value: 1100 } },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main(){ vPos = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vPos; uniform vec3 uColor; uniform vec3 uCenter; uniform float uFade;
      float gridLine(vec2 p, float step){
        vec2 g = abs(fract(p / step - 0.5) - 0.5) / fwidth(p / step);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main(){
        float minor = gridLine(vPos.xz, 15.0) * 0.4;
        float major = gridLine(vPos.xz, 60.0) * 0.95;
        float d = distance(vPos.xz, uCenter.xz);
        float fade = 1.0 - smoothstep(uFade * 0.35, uFade, d);
        float a = max(minor, major) * fade * 0.85;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 5;
  return mesh;
}
