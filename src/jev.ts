// Jev turns one utterance into one Command. Jev is a classifier, not a chat model: we send the
// transcript as `state` plus a fixed set of closed-choice questions, and read back the answers
// relevant to the chosen intent. Free numbers in the transcript override the bucketed answers.
import type { Command, StationId } from './sim';

export type Order = Command | { op: 'report' };

type Choice = { type: 'choice'; instructions: string; criteria: Record<string, string | null> };
const choice = (instructions: string, criteria: Record<string, string | null>): Choice => ({ type: 'choice', instructions, criteria });

export const INTENTS = {
  setSpeed: 'change how fast the ship moves: full ahead, all ahead, half speed, slow, all stop, stop engines',
  turn: 'rotate the ship: turn left / right / port / starboard, come about, hard to port',
  climb: 'change altitude: climb, go up, dive, descend, go down, rise',
  fire: 'start shooting and nothing else: open fire, weapons free, engage, fire at will',
  holdFire: 'stop shooting: hold fire, cease fire, stand down, weapons hold',
  stopBehaviour: 'cancel the current manoeuvre: belay that, stop that, as you were, break off',
  assignCrew: 'move crew to a station: man the engines, put two on sensors, crew the weapons',
  report: 'ask for a status report: report, status, sitrep, what are you doing, where are you',
  unsupported: 'a real order, but one the ship has no way to carry out: formations, get in front of, follow, escort, intercept, dock, retreat to, repair, go to a place, circle, orbit, flank, wheel around something, anything not in the list above',
  none: 'not an order at all: small talk, a comment, a question about the scenery, noise, unclear words',
};

const QUESTIONS = {
  intent: choice('What kind of order did the captain give?', INTENTS),
  speedLevel: choice('If this is a speed order, which speed is requested?', {
    stop: 'stop, halt, all stop, cut engines', slow: 'slow, a third, dead slow, creep',
    half: 'half speed, cruise', full: 'full speed, full ahead, all ahead, all ahead full, flank, maximum, punch it',
  }),
  turnDir: choice('If this is a turn order, which way?', { left: 'left, port, counter-clockwise', right: 'right, starboard, clockwise' }),
  turnAmount: choice('If this is a turn order, roughly how far in degrees?', {
    '15': 'a little, slightly, a touch, 10 to 20 degrees', '30': 'about thirty degrees, or no amount given',
    '45': 'forty-five degrees', '90': 'ninety degrees, hard turn, a right angle', '180': 'come about, reverse course, turn around',
  }),
  climbDir: choice('If this is an altitude order, up or down?', { up: 'climb, rise, ascend, go up', down: 'dive, descend, go down, drop' }),
  climbAmount: choice('If this is an altitude order, roughly how far?', {
    '25': 'a little, slightly', '50': 'a moderate amount, or no amount given', '100': 'a lot, far, way up or way down',
  }),
  station: choice('If this is a crew order, which station?', {
    engines: 'engines, engineering, propulsion, drive', sensoria: 'sensors, sensoria, scanners, radar',
    analysis: 'analysis, identification, intel, classify contacts', weapons: 'weapons, guns, gunnery, turrets',
  }),
  crewCount: choice('If this is a crew order, how many crew?', { '0': 'nobody, none, clear the station', '1': 'one person, someone, or no number given', '2': 'two', '3': 'three, everyone' }),
};

/** Who the order is addressed to. Labels are resolved by the caller; descriptions teach Jev the names. */
export type Roster = Record<string, string>;

export interface JevAnswer { choice: string; confidence: number; probabilities: Record<string, number>; }
export interface Dispatch {
  command: Order | null;
  intent: string;
  ship: string;            // roster label
  confidence: number;      // the weakest judgement used, as in the TypeSafe function-calling cookbook
  weakest: string;         // name of that judgement
  latency: number;
  answers: Record<string, JevAnswer>;
  reason?: string;
}

const firstNumber = (s: string): number | undefined => {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90 };
  const m = s.match(/\d+/);
  if (m) return Number(m[0]);
  for (const w of s.toLowerCase().split(/\s+/)) if (w in words) return words[w];
  return undefined;
};

/** Learned behaviours, as extra intent options: label -> { description, name }. */
export type Learned = Record<string, { description: string; name: string }>;

export async function dispatch(transcript: string, roster: Roster, shipNames: string[] = [], learned: Learned = {}): Promise<Dispatch> {
  const t0 = performance.now();
  // Numbers inside ship names ("Alpha 2") must not be read as amounts.
  let stripped = transcript;
  for (const n of shipNames) stripped = stripped.replace(new RegExp(n.replace(/\s+/g, '\\s*'), 'gi'), ' ');
  const intents: Record<string, string> = { ...INTENTS };
  for (const [id, b] of Object.entries(learned)) intents['do_' + id] = `the manoeuvre "${b.name}": ${b.description}`;
  const questions = {
    ...QUESTIONS,
    intent: choice('What kind of order did the captain give?', intents),
    ship: choice('Which ship or group is the order addressed to?', roster),
    // Fleet-wide addressing is its own yes/no question. Inside the ship choice, an "all ships" option
    // soaked up every "all ahead" and "all stop".
    fleet: { type: 'noul', instructions: 'Does the captain address every ship in the fleet at once?', criteria: {
      true: 'the order contains an explicit fleet-wide address: "all ships", "everyone", "everybody", "whole fleet", "fleet,"',
      false: 'the order names one ship or one class (Vigilant, Kestrel, frigates, fighters, Alpha 2), or names nobody. Words like "all ahead" and "all stop" are speed settings, not addresses',
    } },
  };
  const r = await fetch('/jev', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state: `Captain's order to the fleet: "${transcript}"`, questions }),
  });
  if (!r.ok) throw new Error(`jev ${r.status}: ${await r.text()}`);
  const answers = (await r.json()).answers as Record<string, JevAnswer>;
  const latency = performance.now() - t0;
  const a = (k: keyof typeof questions) => answers[k];
  const intent = a('intent');
  const n = firstNumber(stripped);
  // Tier on the chosen option's probability, which is what the debug bars show. Jev's separate
  // `confidence` field is more conservative and hedged on orders as plain as "full ahead".
  const prob = (x: JevAnswer) => x.probabilities[x.choice] ?? x.confidence;
  const fleet = (answers.fleet as unknown as { noul: number }).noul;
  const ship: JevAnswer = fleet >= 0.85 ? { choice: 'all', confidence: fleet, probabilities: { all: fleet } } : a('ship');
  const used: JevAnswer[] = [intent, ship];
  let command: Order | null = null;
  switch (intent.choice) {
    case 'setSpeed': used.push(a('speedLevel')); command = { op: 'setSpeed', level: a('speedLevel').choice as 'stop' | 'slow' | 'half' | 'full' }; break;
    case 'turn': used.push(a('turnDir')); if (n === undefined) used.push(a('turnAmount')); command = { op: 'turn', dir: a('turnDir').choice as 'left' | 'right', amount: n ?? Number(a('turnAmount').choice) }; break;
    case 'climb': used.push(a('climbDir')); if (n === undefined) used.push(a('climbAmount')); command = { op: 'climb', amount: (a('climbDir').choice === 'down' ? -1 : 1) * (n ?? Number(a('climbAmount').choice)) }; break;
    case 'fire': command = { op: 'fire' }; break;
    case 'holdFire': command = { op: 'holdFire' }; break;
    case 'stopBehaviour': command = { op: 'stopBehaviour' }; break;
    default:
      if (intent.choice.startsWith('do_')) { const id = intent.choice.slice(3); command = { op: 'behaviour', id, name: learned[id]?.name ?? id }; }
      break;
    case 'report': command = { op: 'report' }; break;
    case 'assignCrew': used.push(a('station')); if (n === undefined) used.push(a('crewCount')); command = { op: 'assignCrew', station: a('station').choice as StationId, n: n ?? Number(a('crewCount').choice) }; break;
  }
  const confidence = Math.min(...used.map(prob));
  const weakest = used.map((u) => [u === ship ? 'ship' : Object.keys(answers).find((k) => answers[k] === u) ?? '?', prob(u)] as const)
    .sort((x, y) => x[1] - y[1])[0]?.[0] ?? 'intent';
  const out: Dispatch = { command, intent: intent.choice, ship: ship.choice, confidence, weakest, latency, answers };
  if (intent.choice === 'none') out.reason = 'not an order';
  else if (intent.choice === 'unsupported') out.reason = 'unsupported';
  else if (confidence < 0.45) { out.reason = `unsure (${Math.round(confidence * 100)}%)`; out.command = null; }
  return out;
}
