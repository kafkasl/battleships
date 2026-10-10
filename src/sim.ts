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
}

export const SHIP_TYPES: Record<string, ShipType> = {
  capital: { id: 'capital', length: 150, speedMax: 18, turnRate: 9, climbRate: 10, accel: 0.25, sensorRange: 420 },
  frigate: { id: 'frigate', length: 55, speedMax: 34, turnRate: 24, climbRate: 20, accel: 0.5, sensorRange: 520 },
  fighter: { id: 'fighter', length: 10, speedMax: 60, turnRate: 70, climbRate: 40, accel: 1.2, sensorRange: 250 },
};

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
  crew: number;
  stations: Record<StationId, number>;
  rules: Rule[];
  contacts: Contact[];
  color: string;            // the ship's colour in the log and on its grid marker
  lastOrder: string;        // crew-voice readback of the last order it carried out
}

export const SPEED_LEVELS = { stop: 0, slow: 0.3, half: 0.6, full: 1 } as const;

export function makeShip(p: Partial<Ship> & { id: string; name: string; type: string; faction: Faction }): Ship {
  return {
    pos: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, desiredSpeed: 0, desiredHeading: 0, desiredAltitude: 0,
    turning: 0, hull: 100, crew: 3, stations: { engines: 1, sensoria: 0, analysis: 0, weapons: 0 },
    rules: [], contacts: [], color: '#cfe8ff', lastOrder: 'holding position', ...p,
  };
}

export function wrapDeg(d: number): number { return ((d % 360) + 360) % 360; }
function shortestTurn(from: number, to: number): number { return ((to - from + 540) % 360) - 180; }
export function headingDir(deg: number): Vec3 { const r = (deg * Math.PI) / 180; return { x: Math.sin(r), y: 0, z: -Math.cos(r) }; }

export class Sim {
  ships = new Map<string, Ship>();
  time = 0;

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
      // advance
      const d = headingDir(s.heading);
      const v = s.speed * t.speedMax * dt;
      s.pos.x += d.x * v;
      s.pos.z += d.z * v;
    }
    this.updateContacts();
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
