// The only way anything changes a ship. Debug console, Jev and the rule engine all come through here.
import { type Command, type Ship, type StationId, SHIP_TYPES, SPEED_LEVELS, STATIONS, wrapDeg } from './sim';

export type Result = { ok: true; msg: string } | { ok: false; reason: string };

const needs: Partial<Record<Command['op'], StationId>> = {
  setSpeed: 'engines', turn: 'engines', setHeading: 'engines', climb: 'engines', setAltitude: 'engines', fire: 'weapons',
};

export function execute(ship: Ship, c: Command): Result {
  const station = needs[c.op];
  if (station && ship.stations[station] <= 0) return { ok: false, reason: `nobody is on ${station}` };
  switch (c.op) {
    case 'setSpeed':
      ship.desiredSpeed = SPEED_LEVELS[c.level];
      return { ok: true, msg: `${ship.name}: speed ${c.level}` };
    case 'turn':
      ship.desiredHeading = wrapDeg(ship.desiredHeading + (c.dir === 'left' ? -c.amount : c.amount));
      return { ok: true, msg: `${ship.name}: turning ${c.dir} ${c.amount}°, new heading ${Math.round(ship.desiredHeading)}` };
    case 'setHeading':
      ship.desiredHeading = wrapDeg(c.deg);
      return { ok: true, msg: `${ship.name}: heading ${Math.round(ship.desiredHeading)}` };
    case 'climb':
      ship.desiredAltitude += c.amount;
      return { ok: true, msg: `${ship.name}: ${c.amount >= 0 ? 'climbing' : 'diving'} to ${Math.round(ship.desiredAltitude)}` };
    case 'setAltitude':
      ship.desiredAltitude = c.y;
      return { ok: true, msg: `${ship.name}: altitude ${Math.round(c.y)}` };
    case 'fire':
      return { ok: true, msg: `${ship.name}: firing${c.target ? ' at ' + c.target : ''}` };
    case 'assignCrew': {
      if (!STATIONS.includes(c.station)) return { ok: false, reason: `no station called ${c.station}` };
      const others = STATIONS.filter((s) => s !== c.station).reduce((a, s) => a + ship.stations[s], 0);
      if (others + c.n > ship.crew) return { ok: false, reason: `only ${ship.crew - others} crew free` };
      if (c.n < 0) return { ok: false, reason: 'crew count must be positive' };
      ship.stations[c.station] = c.n;
      return { ok: true, msg: `${ship.name}: ${c.n} crew on ${c.station}` };
    }
  }
}

export function status(ship: Ship): string {
  const t = SHIP_TYPES[ship.type];
  const crew = STATIONS.map((s) => `${s} ${ship.stations[s]}`).join(', ');
  return `${ship.name}: hdg ${Math.round(ship.heading)} (→${Math.round(ship.desiredHeading)}) · spd ${(ship.speed * t.speedMax).toFixed(0)} ` +
    `· alt ${ship.pos.y.toFixed(0)} (→${ship.desiredAltitude.toFixed(0)}) · hull ${ship.hull} · crew ${ship.crew} [${crew}] · contacts ${ship.contacts.length}`;
}

/**
 * Text form of the command vocabulary, for the debug console. Jev will produce the same
 * Command objects from speech; this parser exists so the sim can be driven without it.
 *   speed full | half | slow | stop
 *   turn left 30 | turn right 90 | heading 180
 *   climb 50 | dive 50 | altitude 0
 *   crew engines 2
 *   fire
 */
export function parse(text: string): Command | { error: string } {
  const w = text.trim().toLowerCase().split(/\s+/);
  const num = (s: string | undefined, dflt: number) => { const n = Number(s); return Number.isFinite(n) ? n : dflt; };
  switch (w[0]) {
    case 'speed': case 'ahead':
      if (w[1] in SPEED_LEVELS) return { op: 'setSpeed', level: w[1] as keyof typeof SPEED_LEVELS };
      return { error: 'speed stop|slow|half|full' };
    case 'stop': return { op: 'setSpeed', level: 'stop' };
    case 'turn':
      if (w[1] === 'left' || w[1] === 'right') return { op: 'turn', dir: w[1], amount: num(w[2], 30) };
      return { error: 'turn left|right <degrees>' };
    case 'heading': return { op: 'setHeading', deg: num(w[1], 0) };
    case 'climb': return { op: 'climb', amount: num(w[1], 50) };
    case 'dive': return { op: 'climb', amount: -num(w[1], 50) };
    case 'altitude': case 'alt': return { op: 'setAltitude', y: num(w[1], 0) };
    case 'fire': return { op: 'fire', target: w[1] };
    case 'crew':
      if (STATIONS.includes(w[1] as StationId)) return { op: 'assignCrew', station: w[1] as StationId, n: num(w[2], 1) };
      return { error: `crew ${STATIONS.join('|')} <n>` };
  }
  return { error: `unknown command "${w[0]}"` };
}
