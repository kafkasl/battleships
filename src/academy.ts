// The academy: Opus writes a new behaviour from one sentence. Slow (seconds), used once per idea.
// Jev then routes future orders to it in milliseconds.
import { API_DOC, compile, type Behaviour } from './behaviours';

const MODEL = 'claude-opus-5-5';

/**
 * Stage insurance: a manoeuvre Opus wrote during rehearsal. If the academy is unreachable and the
 * request sounds like it, this one is used so the demo still lands.
 */
const FALLBACK = {
  "id": "orbit_clockwise",
  "name": "Clockwise Orbit",
  "description": "circle clockwise around the enemy, orbit them clockwise, circle right around the target while firing, run a clockwise ring around them, wheel around the enemy to starboard and keep shooting",
  "code": "const e = api.nearest;\napi.weaponsFree(true);\nif (!e) { api.setSpeed('half'); return; }\nconst range = api.me.weaponRange || 1;\nconst r = range * 0.7;\nconst err = (e.dist - r) / r;\nconst k = Math.max(-45, Math.min(60, err * 90));\nconst hdg = ((e.bearing - 90 + k) % 360 + 360) % 360;\napi.setHeading(hdg);\napi.setSpeed(e.dist > range * 1.5 ? 'full' : 'half');"
};

export async function learn(request: string, existing: string[]): Promise<Behaviour> {
  try {
    return await learnOnline(request, existing);
  } catch (e) {
    if (/circl|orbit|around|ring|wheel/i.test(request) && !existing.includes(FALLBACK.id)) {
      console.warn('academy offline, using the rehearsed manoeuvre', e);
      return compile(FALLBACK);
    }
    throw e;
  }
}

async function learnOnline(request: string, existing: string[]): Promise<Behaviour> {
  const system = `${API_DOC}
Respond with JSON only, no prose and no code fences: {"id": "...", "name": "...", "description": "...", "code": "..."}.
id: a short lowercase identifier (letters, digits, underscores), not one of: ${existing.join(', ') || 'none'}.
name: two or three words the crew would call this manoeuvre.
description: one line listing the phrases a captain might use to ask for this manoeuvre, for an intent classifier.
code: the JavaScript function body. Escape newlines as \\n inside the JSON string.`;
  const r = await fetch('/claude', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, messages: [{ role: 'user', content: `Captain's request: "${request}"` }] }),
  });
  if (!r.ok) throw new Error(`academy ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const text: string = j.content?.map((c: { text?: string }) => c.text ?? '').join('') ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('academy returned no JSON');
  const spec = JSON.parse(m[0]) as { id: string; name: string; description: string; code: string };
  const b = compile(spec);
  try { localStorage.setItem('behaviour:' + b.id, JSON.stringify(spec)); } catch { /* storage may be unavailable */ }
  return b;
}

/** Behaviours learned in earlier sessions come back from localStorage. */
export function restore(): Behaviour[] {
  const out: Behaviour[] = [];
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
  } catch { /* ignore */ }
}
