// Standing orders: a sentence like "eagles retreat at half hull" becomes a question Jev is asked once a
// second, per ship, with the live situation as state. Opus writes the question and the allowed answers;
// Jev makes the call; the answer runs through the normal command path.
import { type Command, type Ship, type Sim, SHIP_TYPES, bearing, dist, wrapDeg } from './sim';
import { execute } from './commands';

/** An action an answer maps to. `headTo` is resolved against the live situation when it fires. */
export type StandingCommand = Command | { op: 'headTo'; target: 'mother' | 'nearestEnemy' | 'awayFromEnemy' };

export interface StandingSpec {
  kind: 'standing';
  id: string;
  name: string;
  description: string;                 // phrases a captain would use, for Jev's intent routing
  ships: string;                       // roster label of who it applies to (fighters, frigates, flagship, all)
  question: string;                    // asked of Jev every second with the ship's situation
  actions: Record<string, { description: string; commands: StandingCommand[] }>;
  request?: string;
}

export interface StandingOrder { spec: StandingSpec; armed: boolean; firing: Set<string>; lastAsk: number; }

export const standing = new Map<string, StandingOrder>();

export function addStanding(spec: StandingSpec): StandingOrder {
  const o: StandingOrder = { spec, armed: false, firing: new Set(), lastAsk: 0 };
  standing.set(spec.id, o);
  return o;
}

/** One line per ship: what Jev needs to judge the order. */
export function situation(sim: Sim, s: Ship): string {
  const t = SHIP_TYPES[s.type];
  let near: Ship | null = null, nd = Infinity, mother: Ship | null = null;
  for (const o of sim.ships.values()) {
    if (o === s) continue;
    if (o.faction === s.faction) { if (o.type === 'capital') mother = o; continue; }
    const d = dist(s.pos, o.pos);
    if (d < nd) { nd = d; near = o; }
  }
  const hull = Math.round((s.hull / s.maxHull) * 100);
  return `${s.name} (${s.type}): hull ${hull}%, speed ${Math.round(s.speed * 100)}%, ` +
    (near ? `nearest enemy ${near.name} at ${Math.round(nd)} (weapon range ${t.weaponRange})${nd <= t.weaponRange ? ', in range' : ''}` : 'no enemy in sight') +
    (mother ? `, Mother at ${Math.round(dist(s.pos, mother.pos))} with hull ${Math.round((mother.hull / mother.maxHull) * 100)}%` : ', Mother is gone') +
    (s.behaviour ? `, running manoeuvre ${s.behaviour}` : '') + '.';
}

function resolve(sim: Sim, s: Ship, c: StandingCommand): Command | null {
  if (c.op !== 'headTo') return c;
  let mother: Ship | null = null, near: Ship | null = null, nd = Infinity;
  for (const o of sim.ships.values()) {
    if (o === s) continue;
    if (o.faction === s.faction) { if (o.type === 'capital') mother = o; continue; }
    const d = dist(s.pos, o.pos); if (d < nd) { nd = d; near = o; }
  }
  if (c.target === 'mother') return mother ? { op: 'setHeading', deg: bearing(s.pos, mother.pos) } : null;
  if (c.target === 'nearestEnemy') return near ? { op: 'setHeading', deg: bearing(s.pos, near.pos) } : null;
  return near ? { op: 'setHeading', deg: wrapDeg(bearing(s.pos, near.pos) + 180) } : null;
}

export type Judge = (ships: Ship[], order: StandingOrder) => Promise<Record<string, { choice: string; p: number }>>;

/**
 * Ask Jev about every armed order whose second has come. `judge` sends one request per order with one
 * choice question per ship. Fires the chosen action's commands and reports through `log`.
 */
export async function runStanding(sim: Sim, now: number, resolveShips: (label: string) => Ship[], judge: Judge,
                                  log: (ship: Ship, text: string, firing: boolean) => void) {
  for (const o of standing.values()) {
    if (!o.armed || now - o.lastAsk < 1000) continue;
    o.lastAsk = now;
    const ships = resolveShips(o.spec.ships).filter((s) => sim.ships.has(s.id));
    if (!ships.length) continue;
    let answers: Record<string, { choice: string; p: number }>;
    try { answers = await judge(ships, o); } catch (e) { console.warn('standing', e); continue; }
    for (const s of ships) {
      const a = answers[s.id];
      if (!a) continue;
      const act = a.choice !== 'none' && a.p >= 0.6 ? o.spec.actions[a.choice] : undefined;
      if (!act) { if (o.firing.delete(s.id)) log(s, `${o.spec.name}: standing down.`, false); continue; }
      if (!o.firing.has(s.id)) { o.firing.add(s.id); log(s, `${o.spec.name}: ${a.choice}.`, true); }
      for (const c of act.commands) { const cmd = resolve(sim, s, c); if (cmd) execute(s, cmd); }
    }
  }
}
