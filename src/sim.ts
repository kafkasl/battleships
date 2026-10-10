// Plain-data simulation. No Three.js here: this file must stay runnable in Node for tests.

export type StationId = 'engines' | 'sensoria' | 'analysis' | 'weapons';
export const STATIONS: StationId[] = ['engines', 'sensoria', 'analysis', 'weapons'];
export type Faction = 'player' | 'enemy' | 'neutral';

export interface ShipType {
  id: string;
  length: number;
  speedMax: number;     // units per second at speed 1
  turnRate: number;     // degrees per second
  climbRate: number;    // units per second
  accel: number;        // speed fraction per second
  sensorRange: number;
  hull: number;         // hit points
  weaponRange: number;
  fireRate: number;     // shots per second
  damage: number;       // per shot
}

export const SHIP_TYPES: Record<string, ShipType> = {
  capital: { id: 'capital', length: 150, speedMax: 18, turnRate: 9, climbRate: 10, accel: 0.25, sensorRange: 600, hull: 200, weaponRange: 380, fireRate: 0.8, damage: 9 },
  frigate: { id: 'frigate', length: 55, speedMax: 34, turnRate: 24, climbRate: 20, accel: 0.5, sensorRange: 600, hull: 80, weaponRange: 300, fireRate: 1.2, damage: 5 },
  fighter: { id: 'fighter', length: 10, speedMax: 60, turnRate: 70, climbRate: 40, accel: 1.2, sensorRange: 600, hull: 30, weaponRange: 200, fireRate: 2.5, damage: 1.6 },
};

/** Guns cover everything except a cone astern this wide (degrees). Forward and side batteries only. */
export const BLIND_CONE = 90;
/** Half-size of the square battle arena; ships beyond it are turned back. */
export const ARENA = 800;

export type SimEvent =
  | { type: 'shot'; from: string; to: string; damage: number }
  | { type: 'death'; id: string; pos: Vec3; length: number };

export interface Vec3 { x: number; y: number; z: number; }

export interface Contact { id: string; pos: Vec3; kind: 'unknown' | 'rock' | 'ship' | 'enemy' | 'friendly'; dist: number; }

export interface Rule { when: { contact: 'any' | 'rock' | 'ship' | 'enemy'; within: number }; then: Command[]; }

export type Command =
  | { op: 'setSpeed'; level: 'stop' | 'slow' | 'half' | 'full' }
  | { op: 'turn'; dir: 'left' | 'right'; amount: number }
  | { op: 'setHeading'; deg: number }
  | { op: 'climb'; amount: number }            // negative = dive
  | { op: 'setAltitude'; y: number }
  | { op: 'fire'; target?: string }
  | { op: 'holdFire' }
  | { op: 'behaviour'; id: string; name: string }
  | { op: 'stopBehaviour' }
  | { op: 'assignCrew'; station: StationId; n: number };

export interface Ship {
  id: string;
  name: string;
  type: string;
  faction: Faction;
  pos: Vec3;
  heading: number;          // degrees, 0 = -Z, clockwise from above
  speed: number;            // 0..1 of speedMax
  desiredSpeed: number;
  desiredHeading: number;
  desiredAltitude: number;
  turning: number;          // last tick's signed turn, degrees/s, for the renderer to bank on
  hull: number;
  maxHull: number;
  weaponsFree: boolean;     // shoot at anything hostile in range and arc
  cooldown: number;         // seconds until the next shot
  crew: number;
  stations: Record<StationId, number>;
  rules: Rule[];
  contacts: Contact[];
  behaviour?: string;       // id of the behaviour this ship is running, if any
  returning?: boolean;      // being steered back inside the arena
  memory?: Record<string, unknown>;
  color: string;            // the ship's colour in the log and on its grid marker
  lastOrder: string;        // crew-voice readback of the last order it carried out
}

export const SPEED_LEVELS = { stop: 0, slow: 0.3, half: 0.6, full: 1 } as const;

export function makeShip(p: Partial<Ship> & { id: string; name: string; type: string; faction: Faction }): Ship {
  return {
    pos: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, desiredSpeed: 0, desiredHeading: 0, desiredAltitude: 0,
    turning: 0, hull: p.hull ?? SHIP_TYPES[p.type].hull, maxHull: p.hull ?? SHIP_TYPES[p.type].hull, weaponsFree: false, cooldown: 0, crew: 3, stations: { engines: 1, sensoria: 0, analysis: 0, weapons: 0 },
    rules: [], contacts: [], color: '#cfe8ff', lastOrder: 'holding position', ...p,
  };
}

export function wrapDeg(d: number): number { return ((d % 360) + 360) % 360; }
function shortestTurn(from: number, to: number): number { return ((to - from + 540) % 360) - 180; }
export function headingDir(deg: number): Vec3 { const r = (deg * Math.PI) / 180; return { x: Math.sin(r), y: 0, z: -Math.cos(r) }; }
/** Compass bearing from a to b, same convention as heading. */
export function bearing(a: Vec3, b: Vec3): number { return wrapDeg((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI); }
export function dist(a: Vec3, b: Vec3): number { return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); }
/** Signed angle from the ship's heading to the target, -180..180. Positive = to starboard. */
export function relBearing(s: Ship, p: Vec3): number { return ((bearing(s.pos, p) - s.heading + 540) % 360) - 180; }
export function canFireAt(s: Ship, p: Vec3): boolean {
  return dist(s.pos, p) <= SHIP_TYPES[s.type].weaponRange && Math.abs(relBearing(s, p)) <= 180 - BLIND_CONE / 2;
}

export class Sim {
  ships = new Map<string, Ship>();
  time = 0;
  events: SimEvent[] = [];   // drained by the renderer each frame

  add(s: Ship) { this.ships.set(s.id, s); return s; }
  byName(name: string): Ship | undefined {
    const n = name.trim().toLowerCase();
    for (const s of this.ships.values()) if (s.name.toLowerCase() === n || s.id === n) return s;
    return undefined;
  }

  tick(dt: number) {
    this.time += dt;
    for (const s of this.ships.values()) {
      const t = SHIP_TYPES[s.type];
      // speed eases toward the desired level
      const dv = s.desiredSpeed - s.speed;
      s.speed += Math.sign(dv) * Math.min(Math.abs(dv), t.accel * dt);
      // heading turns the short way round at turnRate
      const dh = shortestTurn(s.heading, s.desiredHeading);
      const step = Math.sign(dh) * Math.min(Math.abs(dh), t.turnRate * dt);
      s.heading = wrapDeg(s.heading + step);
      s.turning = dt > 0 ? step / dt : 0;
      // altitude
      const dy = s.desiredAltitude - s.pos.y;
      s.pos.y += Math.sign(dy) * Math.min(Math.abs(dy), t.climbRate * dt);
      // Soft boundary: past the arena edge the ship is steered home until it is well inside again.
      const r = Math.max(Math.abs(s.pos.x), Math.abs(s.pos.z));
      if (r > ARENA) s.returning = true; else if (r < ARENA * 0.85) s.returning = false;
      if (s.returning) s.desiredHeading = bearing(s.pos, { x: 0, y: 0, z: 0 });
      // advance
      const d = headingDir(s.heading);
      const v = s.speed * t.speedMax * dt;
      s.pos.x += d.x * v;
      s.pos.z += d.z * v;
    }
    this.updateContacts();
    this.combat(dt);
  }

  /** Nearest hostile the ship could hit right now, or null. */
  target(s: Ship): Ship | null {
    let best: Ship | null = null, bd = Infinity;
    for (const o of this.ships.values()) {
      if (o.faction === s.faction || o.faction === 'neutral') continue;
      const d = dist(s.pos, o.pos);
      if (d < bd && canFireAt(s, o.pos)) { bd = d; best = o; }
    }
    return best;
  }

  private combat(dt: number) {
    const dead: Ship[] = [];
    for (const s of this.ships.values()) {
      s.cooldown = Math.max(0, s.cooldown - dt);
      if (!s.weaponsFree || s.cooldown > 0) continue;
      const t = this.target(s);
      if (!t) continue;
      const type = SHIP_TYPES[s.type];
      s.cooldown = 1 / type.fireRate;
      t.hull -= type.damage;
      this.events.push({ type: 'shot', from: s.id, to: t.id, damage: type.damage });
      if (t.hull <= 0 && !dead.includes(t)) dead.push(t);
    }
    for (const t of dead) {
      this.ships.delete(t.id);
      this.events.push({ type: 'death', id: t.id, pos: { ...t.pos }, length: SHIP_TYPES[t.type].length });
    }
  }

  /** Each ship only knows what its manned stations can tell it. */
  private updateContacts() {
    for (const s of this.ships.values()) {
      s.contacts = [];
      if (s.stations.sensoria <= 0) continue;
      const range = SHIP_TYPES[s.type].sensorRange;
      for (const o of this.ships.values()) {
        if (o === s) continue;
        const dist = Math.hypot(o.pos.x - s.pos.x, o.pos.y - s.pos.y, o.pos.z - s.pos.z);
        if (dist > range) continue;
        const classified = s.stations.analysis > 0;
        const kind = !classified ? 'unknown' : o.faction === s.faction ? 'friendly' : o.faction === 'neutral' ? 'ship' : 'enemy';
        s.contacts.push({ id: o.id, pos: { ...o.pos }, kind, dist });
      }
    }
  }
}
