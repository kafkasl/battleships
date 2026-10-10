// The academy: Opus writes a new behaviour from one sentence. Slow (seconds), used once per idea.
// Jev then routes future orders to it in milliseconds.
import { API_DOC, compile, type Behaviour } from './behaviours';

const MODEL = 'claude-opus-5-5';

/**
 * Stage insurance: manoeuvres Opus wrote during rehearsal. They are shown to Opus as worked examples,
 * and if the academy is unreachable and a request sounds like one of them, it is used directly.
 */
const EXAMPLES: { request: string; match: RegExp; spec: { id: string; name: string; description: string; code: string } }[] = [
  { request: 'Frigates, circle the Dragon while firing', match: /circl|orbit|around|ring|wheel/i, spec: {
  "id": "orbit_clockwise",
  "name": "Clockwise Orbit",
  "description": "circle clockwise around the enemy, orbit them clockwise, circle right around the target while firing, run a clockwise ring around them, wheel around the enemy to starboard and keep shooting",
  "code": "const e = api.nearest;\napi.weaponsFree(true);\nif (!e) { api.setSpeed('half'); return; }\nconst range = api.me.weaponRange || 1;\nconst r = range * 0.7;\nconst err = (e.dist - r) / r;\nconst k = Math.max(-45, Math.min(60, err * 90));\nconst hdg = ((e.bearing - 90 + k) % 360 + 360) % 360;\napi.setHeading(hdg);\napi.setSpeed(e.dist > range * 1.5 ? 'full' : 'half');"
} },
  { request: 'Eagles, stay behind Mother and shoot anything in range', match: /behind|astern|escort|screen|form up|shelter|stay with|follow|cover/i, spec: {
  "id": "screen_astern_flagship",
  "name": "Form Astern",
  "description": "small ships stay behind the capital ship, frigates and fighters fall in behind the flagship, form up astern of the capital, escorts take station behind the flagship, get behind the big ship, trail the capital ship, shelter behind the flagship",
  "code": "const me = api.me, f = api.flagship;\napi.weaponsFree(true);\nif (me.type === 'capital') return;\nif (!f) { const e = api.nearest; if (e) api.setHeading(e.bearing); api.setSpeed('half'); return; }\nif (api.remember.slot === undefined) {\n  let h = 0; for (let i = 0; i < me.name.length; i++) h = (h * 31 + me.name.charCodeAt(i)) % 997;\n  api.remember.slot = (h % 5) - 2;\n}\nconst range = me.weaponRange || 100;\nconst back = range * 0.5;\nconst lat = api.remember.slot * range * 0.2;\nconst rad = Math.PI / 180;\nconst bh = (f.heading + 180) * rad, sh = (f.heading + 90) * rad;\nconst px = f.x + back * Math.sin(bh) + lat * Math.sin(sh);\nconst pz = f.z - back * Math.cos(bh) - lat * Math.cos(sh);\nconst d = api.distTo(px, pz);\nconst tol = range * 0.15;\nif (d > tol) {\n  api.setHeading(api.bearingTo(px, pz));\n  api.setSpeed(d > range ? 'full' : d > range * 0.4 ? 'half' : 'slow');\n} else {\n  api.setHeading(f.heading);\n  api.setSpeed('half');\n}"
} },
  { request: 'Mother, close in on the Dragon and keep shooting it', match: /dragon|capital|hammer|focus|close in/i, spec: {
  "id": "close_and_hammer",
  "name": "Close and Hammer",
  "description": "close in on the Dragon and keep shooting it, focus fire on the Dragon, hammer the Dragon, go for the enemy capital ship, attack the Dragon",
  "code": "const me = api.me, es = api.enemies;\napi.weaponsFree(true);\nif (!es.length) { api.target(null); api.setSpeed('half'); return; }\nlet t = es.find(e => /dragon/i.test(e.name || ''));\nif (!t && api.remember.tid !== undefined) t = es.find(e => e.id === api.remember.tid);\nif (!t) t = es[0];\napi.remember.tid = t.id;\napi.target(t.id);\nconst range = me.weaponRange || 100;\nconst want = range * 0.55;\nif (t.dist > range) {\n  api.setHeading(t.bearing);\n  api.setSpeed('full');\n} else if (t.dist > want) {\n  api.setHeading(t.bearing);\n  api.setSpeed('half');\n} else {\n  const side = t.relBearing >= 0 ? -1 : 1;\n  const off = t.dist < want * 0.6 ? 80 : 50;\n  api.setHeading(((t.bearing + side * off) % 360 + 360) % 360);\n  api.setSpeed('slow');\n}"
} }
];

export async function learn(request: string, existing: string[]): Promise<Behaviour> {
  try {
    return await learnOnline(request, existing);
  } catch (e) {
    const ex = EXAMPLES.find((x) => x.match.test(request) && !existing.includes(x.spec.id));
    if (ex) { console.warn('academy offline, using a rehearsed manoeuvre', e); return compile({ ...ex.spec, request }); }
    throw e;
  }
}

async function learnOnline(request: string, existing: string[]): Promise<Behaviour> {
  const system = `${API_DOC}
Respond with JSON only, no prose and no code fences: {"id": "...", "name": "...", "description": "...", "code": "..."}.
id: a short lowercase identifier (letters, digits, underscores), not one of: ${existing.join(', ') || 'none'}.
name: two or three words the crew would call this manoeuvre.
description: one line listing the phrases a captain might use to ask for this manoeuvre, for an intent classifier.
code: the JavaScript function body. Escape newlines as \\n inside the JSON string.

Two examples of good answers:
${EXAMPLES.map((x) => `Request: "${x.request}"\n${JSON.stringify(x.spec)}`).join('\n\n')}`;
  const r = await fetch('/claude', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, messages: [{ role: 'user', content: `Captain's request: "${request}"` }] }),
  });
  if (!r.ok) throw new Error(`academy ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const text: string = j.content?.map((c: { text?: string }) => c.text ?? '').join('') ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('academy returned no JSON');
  const spec = JSON.parse(m[0]) as { id: string; name: string; description: string; code: string; request?: string };
  spec.request = request;
  const b = compile(spec);
  try { localStorage.setItem('behaviour:' + b.id, JSON.stringify(spec)); } catch { /* storage may be unavailable */ }
  return b;
}

/** Behaviours learned in earlier sessions come back from localStorage. `?stage` in the URL starts empty. */
export function restore(): Behaviour[] {
  const out: Behaviour[] = [];
  if (location.search.includes('stage')) { forgetAll(); return out; }
  // A fresh browser starts with the three rehearsed manoeuvres as buttons; "clear" removes them until site data is reset.
  try {
    const any = Object.keys(localStorage).some((k) => k.startsWith('behaviour:')) || localStorage.getItem('manoeuvres:cleared') === '1';
    if (!any) for (const x of EXAMPLES) localStorage.setItem('behaviour:' + x.spec.id, JSON.stringify({ ...x.spec, request: x.request }));
  } catch { /* ignore */ }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!k.startsWith('behaviour:')) continue;
      try { out.push(compile(JSON.parse(localStorage.getItem(k)!))); } catch { /* skip a broken one */ }
    }
  } catch { /* storage may be unavailable */ }
  return out;
}

export function forgetAll() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i)!; if (k.startsWith('behaviour:')) localStorage.removeItem(k); }
    if (!location.search.includes('stage')) localStorage.setItem('manoeuvres:cleared', '1');
  } catch { /* ignore */ }
}
