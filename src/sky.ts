import * as THREE from 'three';
import { glowTexture } from './fx';

// Ashima/Gustavson 3D simplex noise.
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float a=0.5; float s=0.0; for(int i=0;i<6;i++){ s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
`;

const VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
${NOISE}
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uColDeep, uColMid, uColHot, uSunCol;
uniform float uTime;
void main(){
  vec3 d = normalize(vDir);
  float n1 = fbm(d * 1.6);
  float n2 = fbm(d * 3.8 + n1 * 0.9 + vec3(4.1, 2.2, 7.7));
  float n3 = fbm(d * 7.0 - n2 * 0.5 + vec3(9.0, 1.0, 3.0));
  float body = smoothstep(-0.35, 0.75, n1 * 0.6 + n2 * 0.4);
  float wisps = smoothstep(0.1, 0.9, n2 * 0.5 + 0.5) * smoothstep(0.2, 0.8, n3 * 0.5 + 0.5);
  vec3 col = mix(uColDeep, uColMid, body);
  col = mix(col, uColHot, wisps * 0.55);
  // dark dust lanes cutting through
  float dust = smoothstep(0.35, 0.75, fbm(d * 2.6 + vec3(2.0, 3.0, 4.0)) * 0.5 + 0.5);
  col *= mix(1.0, 0.35, dust * (1.0 - wisps * 0.5));
  // the sun bleeding into the frame
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(s, 3.0) * 0.35 + pow(s, 14.0) * 1.4 + pow(s, 90.0) * 6.0);
  // lit side of the nebula faces the sun
  col *= 0.75 + 0.5 * pow(s, 1.5);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SUN_DIR = new THREE.Vector3(0.78, 0.22, -0.58).normalize();
export const NEBULA_FOG = new THREE.Color(0x4b1a18);

export function makeSky(): THREE.Group {
  const g = new THREE.Group();

  const nebula = new THREE.Mesh(
    new THREE.SphereGeometry(6000, 48, 32),
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSunDir: { value: SUN_DIR },
        uColDeep: { value: new THREE.Color(0x1d090f) },
        uColMid: { value: new THREE.Color(0x8a3626) },
        uColHot: { value: new THREE.Color(0xd9843f) },
        uSunCol: { value: new THREE.Color(0xffd7a3) },
        uTime: { value: 0 },
      },
    }),
  );
  nebula.renderOrder = -10;
  g.add(nebula);

  // Stars: many small, a few bright.
  const tex = glowTexture();
  const mk = (count: number, size: number, bright: number) => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(5800);
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHSL(0.55 + Math.random() * 0.15, 0.3 + Math.random() * 0.4, 0.75 + Math.random() * 0.25);
      c.multiplyScalar(bright * (0.4 + Math.random() * 0.6));
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size, map: tex, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: false, fog: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = -9;
    return pts;
  };
  g.add(mk(5000, 2.2, 0.9));
  g.add(mk(300, 5.0, 1.8));

  // The sun itself: a huge additive sprite that bloom turns into a wall of light.
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xffe3b8, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  sun.position.copy(SUN_DIR).multiplyScalar(5500);
  sun.scale.setScalar(2600);
  sun.renderOrder = -8;
  g.add(sun);

  return g;
}
