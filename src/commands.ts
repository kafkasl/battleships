// The only way anything changes a ship. Debug console, Jev and the rule engine all come through here.
import { type Command, type Ship, type StationId, SHIP_TYPES, SPEED_LEVELS, STATIONS, wrapDeg } from './sim';

export type Result = { ok: true; msg: string } | { ok: false; reason: string };

const needs: Partial<Record<Command['op'], StationId>> = {
  setSpeed: 'engines', turn: 'engines', setHeading: 'engines', climb: 'engines', setAltitude: 'engines',
};

export function execute(ship: Ship, c: Command): Result {
  const station = needs[c.op];
  if (station && ship.stations[station] <= 0) return { ok: false, reason: `Nobody is on ${station === 'sensoria' ? 'sensors' : station}, captain.` };
  let msg: string;
  const manual = c.op === 'setSpeed' || c.op === 'turn' || c.op === 'setHeading' || c.op === 'climb' || c.op === 'setAltitude';
  const wasRunning = manual && ship.behaviour ? ship.behaviour : undefined;
  if (manual) ship.behaviour = undefined;
  switch (c.op) {
    case 'behaviour':
      ship.behaviour = c.id;
      ship.memory = {};
      msg = `${c.name}, aye.`;
      break;
    case 'stopBehaviour':
      msg = ship.behaviour ? 'Belay that, holding course.' : 'Nothing to belay.';
      ship.behaviour = undefined;
      break;
    case 'setSpeed':
      ship.desiredSpeed = SPEED_LEVELS[c.level];
      msg = { stop: 'All stop.', slow: 'Slow ahead.', half: 'Half ahead.', full: 'Full ahead.' }[c.level];
      break;
    case 'turn':
      ship.desiredHeading = wrapDeg(ship.desiredHeading + (c.dir === 'left' ? -c.amount : c.amount));
      msg = `${c.dir === 'left' ? 'Port' : 'Starboard'} ${c.amount}, coming to ${hdg(ship.desiredHeading)}.`;
      break;
    case 'setHeading':
      ship.desiredHeading = wrapDeg(c.deg);
      msg = `Coming to ${hdg(ship.desiredHeading)}.`;
      break;
    case 'climb':
      ship.desiredAltitude += c.amount;
      msg = `${c.amount >= 0 ? 'Climbing' : 'Diving'} ${Math.abs(c.amount)}, to ${Math.round(ship.desiredAltitude)}.`;
      break;
    case 'setAltitude':
      ship.desiredAltitude = c.y;
      msg = `Altitude ${Math.round(c.y)}.`;
      break;
    case 'fire':
      ship.weaponsFree = true;
      msg = 'Weapons free.';
      break;
    case 'holdFire':
      ship.weaponsFree = false;
      msg = 'Holding fire.';
      break;
    case 'assignCrew': {
      if (!STATIONS.includes(c.station)) return { ok: false, reason: `No station called ${c.station}.` };
      if (c.n < 0) return { ok: false, reason: 'Crew count must be positive.' };
      const others = STATIONS.filter((s) => s !== c.station).reduce((a, s) => a + ship.stations[s], 0);
      if (others + c.n > ship.crew) return { ok: false, reason: `Only ${ship.crew - others} crew free, captain.` };
      ship.stations[c.station] = c.n;
      msg = `${c.n} on ${c.station === 'sensoria' ? 'sensors' : c.station}.`;
      break;
    }
  }
  if (wasRunning) msg += ' Manoeuvre cancelled.';
  ship.lastOrder = msg;
  return { ok: true, msg };
}

const hdg = (d: number) => Math.round(d).toString().padStart(3, '0');

/** Crew-voice situation report, for "report status" and the ship card. */
export function report(ship: Ship): string {
  const t = SHIP_TYPES[ship.type];
  const spd = ship.desiredSpeed === 0 ? 'stopped' : ship.desiredSpeed >= 1 ? 'full ahead' : ship.desiredSpeed >= 0.6 ? 'half ahead' : 'slow ahead';
  const manned = STATIONS.filter((s) => ship.stations[s] > 0).map((s) => `${s === 'sensoria' ? 'sensors' : s} ${ship.stations[s]}`);
  return `${spd}, heading ${hdg(ship.heading)}, altitude ${Math.round(ship.pos.y)}, speed ${Math.round(ship.speed * t.speedMax)}. ` +
    `Hull ${Math.round(ship.hull)} of ${ship.maxHull}, ${ship.weaponsFree ? 'weapons free' : 'holding fire'}. Crew: ${manned.length ? manned.join(', ') : 'nobody at a station'}. ` +
    (ship.contacts.length ? `${ship.contacts.length} contact${ship.contacts.length > 1 ? 's' : ''}.` : 'No contacts.');
}

export function status(ship: Ship): string { return `${ship.name}: ${report(ship)}`; }

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
    case 'fire': return { op: 'fire' };
    case 'hold': return { op: 'holdFire' };
    case 'belay': return { op: 'stopBehaviour' };
    case 'crew':
      if (STATIONS.includes(w[1] as StationId)) return { op: 'assignCrew', station: w[1] as StationId, n: num(w[2], 1) };
      return { error: `crew ${STATIONS.join('|')} <n>` };
  }
  return { error: `unknown command "${w[0]}"` };
}
