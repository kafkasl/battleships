// Regression suite for order routing. Calls the real Jev API with the game's own questions.
//   TYPESAFE_API_KEY=... npm test
// Each case: the phrase, who must receive it, and which operations must come back (primary + extras).
import { dispatch } from '../src/jev';

const KEY = process.env.TYPESAFE_API_KEY;
if (!KEY) { console.error('TYPESAFE_API_KEY not set'); process.exit(2); }

// The game calls fetch('/jev'); here that goes straight to the API with the key.
const realFetch = globalThis.fetch;
globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
  realFetch(String(url) === '/jev' ? 'https://api.typesafe.ai/v1/systemone' : url,
    { ...init, headers: { ...(init?.headers as Record<string, string>), Authorization: `Bearer ${KEY}` } })) as typeof fetch;
(globalThis as unknown as { performance: Performance }).performance ??= { now: () => Date.now() } as Performance;

// Same roster as src/main.ts. Keep in sync.
const roster = {
  flagship: 'Mother, our capital ship, the mothership, the flagship, the big ship. Also the default when the order names no particular ship',
  red: 'Red, the frigate named Red (not Blue)',
  blue: 'Blue, the frigate named Blue (not Red)',
  frigates: 'both frigates: the frigates, Red and Blue, the escorts',
  eagle1: 'the fighter Eagle 1, eagle one',
  eagle2: 'the fighter Eagle 2, eagle two',
  eagle3: 'the fighter Eagle 3, eagle three',
  fighters: 'all three fighters: the fighters, the eagles, the wing',
  enemy: 'the enemy ship Dragon, the enemy capital ship, the drones, them',
};
const names = ['Mother', 'Red', 'Blue', 'Eagle 1', 'Eagle 2', 'Eagle 3', 'Dragon'];
const expand = (labels: string[]): Set<string> => new Set(labels.flatMap((l) =>
  l === 'all' ? ['flagship', 'red', 'blue', 'eagle1', 'eagle2', 'eagle3'] : l === 'frigates' ? ['red', 'blue'] : l === 'fighters' ? ['eagle1', 'eagle2', 'eagle3'] : [l]));

interface Case { text: string; ships: string[]; ops: string[]; }
const CASES: Case[] = [
  { text: 'full ahead', ships: ['flagship'], ops: ['setSpeed'] },
  { text: 'turn left 30', ships: ['flagship'], ops: ['turn'] },
  { text: 'Mother, full ahead', ships: ['flagship'], ops: ['setSpeed'] },
  { text: 'all ships, full ahead', ships: ['all'], ops: ['setSpeed'] },
  { text: 'All battleships move forward', ships: ['all'], ops: ['setSpeed'] },
  { text: 'everyone engage', ships: ['all'], ops: ['behaviour'] },
  { text: 'all ships, engage the enemy', ships: ['all'], ops: ['behaviour'] },
  { text: 'All ships, full ahead and shoot the enemy', ships: ['all'], ops: ['setSpeed', 'fire'] },
  { text: 'Mother and frigates, full ahead and open fire', ships: ['flagship', 'frigates'], ops: ['setSpeed', 'fire'] },
  { text: 'Mother, blue and red, more move ahead and fire on the enemy', ships: ['flagship', 'red', 'blue'], ops: ['setSpeed', 'fire'] },
  { text: 'Red and Blue, stop', ships: ['red', 'blue'], ops: ['setSpeed'] },
  { text: 'kestrel heron stop'.replace('kestrel heron', 'red blue'), ships: ['red', 'blue'], ops: ['setSpeed'] },
  { text: 'frigates, stop', ships: ['frigates'], ops: ['setSpeed'] },
  { text: 'eagles, hold position', ships: ['fighters'], ops: ['setSpeed'] },
  { text: 'Eagle 2, open fire', ships: ['eagle2'], ops: ['fire'] },
  { text: 'Eagle 1 and Eagle 3, turn left 30', ships: ['eagle1', 'eagle3'], ops: ['turn'] },
  { text: 'Eagle 2 hard to port', ships: ['eagle2'], ops: ['turn'] },
  { text: 'hold fire and come about', ships: ['flagship'], ops: ['holdFire', 'turn'] },
  { text: 'fighters, belay that', ships: ['fighters'], ops: ['stopBehaviour'] },
  { text: 'all ships report', ships: ['all'], ops: ['report'] },
  { text: 'Blue, what are you doing', ships: ['blue'], ops: ['report'] },
  { text: 'climb 50', ships: ['flagship'], ops: ['climb'] },
  { text: 'Dragon, open fire', ships: ['enemy'], ops: ['fire'] },
];

let failed = 0;
for (const c of CASES) {
  const d = await dispatch(c.text, roster, names, {});
  const got = expand(d.ships), want = expand(c.ships);
  const ops = [d.command, ...d.extras].filter(Boolean).map((o) => o!.op);
  const shipsOk = [...want].every((s) => got.has(s)) && [...got].every((s) => want.has(s));
  const opsOk = c.ops.every((o) => ops.includes(o)) && ops.every((o) => c.ops.includes(o));
  const ok = shipsOk && opsOk && d.confidence >= 0.45;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.text}\n      ships ${[...got].join(',') || '-'}  ops ${ops.join(',') || '-'}  conf ${Math.round(d.confidence * 100)}%  ${Math.round(d.latency)} ms`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
process.exit(failed ? 1 : 0);
