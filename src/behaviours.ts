// Behaviours: small programs a ship runs every tick. Opus writes them from a sentence; Jev routes
// later utterances to them. The API below is the whole world a behaviour can see or touch.
import { type Ship, type Sim, SHIP_TYPES, SPEED_LEVELS, bearing, dist, relBearing, canFireAt, wrapDeg } from './sim';

export interface ShipView { id: string; name: string; type: string; x: number; z: number; altitude: number; heading: number; dist: number; bearing: number; relBearing: number; hull: number; inArc: boolean; }

export interface BehaviourAPI {
  dt: number;
  me: { name: string; type: string; x: number; z: number; heading: number; speed: number; altitude: number; hull: number; weaponRange: number; turnRate: number; speedMax: number };
  enemies: ShipView[];           // sorted nearest first
  nearest: ShipView | null;
  friends: ShipView[];           // my side, sorted nearest first, not including me
  flagship: ShipView | null;     // my side's capital ship, if alive
  bearingTo(x: number, z: number): number;   // compass bearing from me to a point
  distTo(x: number, z: number): number;
  setSpeed(level: 'stop' | 'slow' | 'half' | 'full'): void;
  setHeading(deg: number): void; // absolute compass heading, 0..360, the ship turns toward it at its turn rate
  turn(dir: 'left' | 'right', degrees: number): void;
  climb(amount: number): void;   // negative dives
  weaponsFree(on: boolean): void;
  remember: Record<string, unknown>;   // scratch space that survives between ticks
}

/** Shown to Opus verbatim. Keep it in sync with BehaviourAPI. */
export const API_DOC = `
You write a behaviour for a warship in a space battle. A behaviour is the body of a JavaScript function
that runs every simulation tick (about 20 times per second) with one argument, \`api\`:

  api.dt                      seconds since the last tick
  api.me                      { name, type, x, z, heading, speed, altitude, hull, weaponRange, turnRate, speedMax }
                              x, z: position on the battle plane. heading: compass degrees, 0 = north (-z), 90 = east (+x), clockwise.
                              A point at distance d along compass bearing b is (x + d*sin(b°), z - d*cos(b°)).
                              type is 'capital', 'frigate' or 'fighter'. speed is 0..1 of speedMax.
  api.enemies                 hostile ships sorted nearest first, each { id, name, type, x, z, altitude, heading, dist, bearing, relBearing, hull, inArc }
                              bearing: compass bearing from me to it. relBearing: -180..180, positive = to my right (starboard)
                              inArc: true if my guns can reach it now (inside weaponRange and not in the 90° cone behind me)
  api.nearest                 the first enemy or null
  api.friends                 ships on my side (not me), same shape as enemies, sorted nearest first
  api.flagship                my side's capital ship or null
  api.bearingTo(x, z)         compass bearing from me to a point
  api.distTo(x, z)            distance from me to a point
  api.setSpeed('stop'|'slow'|'half'|'full')
  api.setHeading(deg)         desired compass heading; the ship turns toward it at its turnRate (deg/s)
  api.turn('left'|'right', degrees)   relative to the current desired heading
  api.climb(amount)           change desired altitude, negative dives
  api.weaponsFree(true|false) guns fire automatically at the nearest enemy in arc when free
  api.remember                an object that persists between ticks, for state

Rules: no loops that never end, no async, no DOM, no imports. Only use the api. Keep it under 40 lines.
Guns cannot fire into the 90° cone directly astern, so a ship that wants to keep shooting must keep the
target ahead or abeam, never behind. Ships cannot strafe sideways: they move along their heading.
`;

export interface Behaviour {
  id: string;           // short identifier, also the Jev intent label
  name: string;         // what the crew calls it
  description: string;  // one line for Jev's intent question: phrases a captain would use to ask for it
  code: string;         // function body
  fn: (api: BehaviourAPI) => void;
}

export const behaviours = new Map<string, Behaviour>();

export function compile(b: Omit<Behaviour, 'fn'>): Behaviour {
  const fn = new Function('api', b.code) as (api: BehaviourAPI) => void;
  const out = { ...b, fn };
  behaviours.set(b.id, out);
  return out;
}

export type BehaviourFailure = (ship: Ship, err: unknown) => void;

/** Run every ship's behaviour for one tick. A crash disables that ship's behaviour and reports it. */
export function runBehaviours(sim: Sim, dt: number, onFail: BehaviourFailure) {
  for (const s of sim.ships.values()) {
    if (!s.behaviour) continue;
    const b = behaviours.get(s.behaviour);
    if (!b) { s.behaviour = undefined; continue; }
    try {
      b.fn(apiFor(sim, s, dt));
    } catch (e) {
      s.behaviour = undefined;
      onFail(s, e);
    }
  }
}

function apiFor(sim: Sim, s: Ship, dt: number): BehaviourAPI {
  const t = SHIP_TYPES[s.type];
  const enemies: ShipView[] = [], friends: ShipView[] = [];
  for (const o of sim.ships.values()) {
    if (o === s || o.faction === 'neutral') continue;
    const view: ShipView = { id: o.id, name: o.name, type: o.type, x: o.pos.x, z: o.pos.z, altitude: o.pos.y, heading: o.heading,
      dist: dist(s.pos, o.pos), bearing: bearing(s.pos, o.pos), relBearing: relBearing(s, o.pos), hull: o.hull, inArc: canFireAt(s, o.pos) };
    (o.faction === s.faction ? friends : enemies).push(view);
  }
  enemies.sort((a, b) => a.dist - b.dist);
  friends.sort((a, b) => a.dist - b.dist);
  s.memory ??= {};
  return {
    dt,
    me: { name: s.name, type: s.type, x: s.pos.x, z: s.pos.z, heading: s.heading, speed: s.speed, altitude: s.pos.y, hull: s.hull, weaponRange: t.weaponRange, turnRate: t.turnRate, speedMax: t.speedMax },
    enemies,
    nearest: enemies[0] ?? null,
    friends,
    flagship: friends.find((f) => f.type === 'capital') ?? null,
    bearingTo: (x, z) => bearing(s.pos, { x, y: 0, z }),
    distTo: (x, z) => Math.hypot(x - s.pos.x, z - s.pos.z),
    setSpeed: (level) => { s.desiredSpeed = SPEED_LEVELS[level] ?? s.desiredSpeed; },
    setHeading: (deg) => { if (Number.isFinite(deg)) s.desiredHeading = wrapDeg(deg); },
    turn: (dir, degrees) => { if (Number.isFinite(degrees)) s.desiredHeading = wrapDeg(s.desiredHeading + (dir === 'left' ? -degrees : degrees)); },
    climb: (amount) => { if (Number.isFinite(amount)) s.desiredAltitude += amount; },
    weaponsFree: (on) => { s.weaponsFree = !!on; },
    remember: s.memory,
  };
}
