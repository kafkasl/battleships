// Order log: one line per ship per order, built for a glance: badge in the ship's colour, a
// crew-voice readback, and a confidence tier shown as a colour bar. D toggles the debug detail.
import { parse, execute, report } from './commands';
import { dispatch, type Roster, type Dispatch, type Learned } from './jev';
import { behaviours } from './behaviours';
import { learn } from './academy';
import type { Sim, Ship, Command } from './sim';

export interface Addressing {
  roster: Roster;                                   // label -> description, sent to Jev
  resolve: (label: string) => Ship[];               // label -> ships to order
}

type Tier = 'sure' | 'hedge' | 'refused' | 'info' | 'academy' | 'learned';
const tier = (conf: number): Tier => (conf >= 0.7 ? 'sure' : conf >= 0.45 ? 'hedge' : 'refused');

const learned = (): Learned => Object.fromEntries([...behaviours.values()].map((b) => [b.id, { description: b.description, name: b.name }]));

export function installConsole(sim: Sim, flagship: () => Ship, addressing: () => Addressing,
                               onOrder: (ship: Ship) => void, onLearned: (name: string) => void = () => {}) {
  const box = document.createElement('div');
  box.id = 'console';
  box.innerHTML = `<div id="log"></div><div id="chips"></div><input id="cmd" placeholder="type or dictate an order, then Enter" autocomplete="off" />`;
  document.body.appendChild(box);
  const log = box.querySelector('#log') as HTMLDivElement;
  const input = box.querySelector('#cmd') as HTMLInputElement;
  const chips = box.querySelector('#chips') as HTMLDivElement;
  // Tappable example orders: a stranger (or a phone) can play without typing a word.
  for (const text of ['all ships, weapons free', 'all ships, full ahead', 'fighters, stay behind the Vigilant', 'frigates, circle the Ravager while firing', 'Alpha 1, belay that', 'all ships report']) {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', () => { submit(text); input.blur(); });
    chips.appendChild(b);
  }
  let debug = false;

  const line = (t: Tier, ship: Ship | null, text: string, detail = '') => {
    const d = document.createElement('div');
    d.className = `line ${t}`;
    const badge = ship ? `<span class="badge" style="color:${ship.color};border-color:${ship.color}">${ship.name}</span>` : t === 'academy' || t === 'learned' ? '<span class="badge academy">Academy</span>' : '<span class="badge you">You</span>';
    d.innerHTML = `${badge}<span class="text"></span>${detail ? '<span class="detail"></span>' : ''}`;
    (d.querySelector('.text') as HTMLSpanElement).textContent = text;
    if (detail) (d.querySelector('.detail') as HTMLSpanElement).textContent = detail;
    log.appendChild(d);
    while (log.children.length > 12) log.removeChild(log.firstChild!);
    log.scrollTop = log.scrollHeight;
    return d;
  };

  const carryOut = (ships: Ship[], c: Command, t: Tier) => {
    for (const s of ships) {
      const r = execute(s, c);
      line(r.ok ? t : 'refused', s, r.ok ? (t === 'hedge' ? r.msg.replace(/\.$/, '?') : r.msg) : r.reason);
      if (r.ok) onOrder(s);
    }
  };

  const detailOf = (d: Dispatch) => {
    const top = (k: string, n = 2) => Object.entries(d.answers[k]?.probabilities ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([l, p]) => `${l} ${Math.round(p * 100)}%`).join(' / ');
    const fleet = Math.round(((d.answers.fleet as unknown as { noul: number })?.noul ?? 0) * 100);
    return `ship ${top('ship')} · fleet ${fleet}% · intent ${top('intent')} · weakest ${d.weakest} ${Math.round(d.confidence * 100)}% · ${Math.round(d.latency)} ms · ${JSON.stringify(d.command)}`;
  };

  const viaJev = async (text: string) => {
    onOrder(flagship()); // any order starts the match clock
    const pending = line('info', null, text);
    const { roster, resolve } = addressing();
    try {
      const d = await dispatch(text, roster, [...sim.ships.values()].map((s) => s.name), learned());
      if (debug) pending.insertAdjacentHTML('beforeend', '<span class="detail"></span>');
      const det = pending.querySelector('.detail') as HTMLSpanElement | null;
      if (det) det.textContent = detailOf(d);
      pending.dataset.detail = detailOf(d);
      const ships = resolve(d.ship);
      const speaker = ships[0] ?? flagship();
      // Understood but impossible is a different answer from not understood. Send it to the academy:
      // Opus writes the manoeuvre once, the ships run it, and from now on Jev routes to it directly.
      if (d.intent === 'unsupported') {
        line('refused', speaker, "Understood, captain, but we don't know how to do that yet.");
        const teaching = line('academy', null, `writing a manoeuvre for "${text}"…`);
        teaching.insertAdjacentHTML('beforeend', '<div class="progress"><div></div></div>');
        try {
          const b = await learn(text, [...behaviours.keys()]);
          teaching.className = 'line learned';
          teaching.querySelector('.progress')?.remove();
          (teaching.querySelector('.text') as HTMLSpanElement).textContent = `new manoeuvre "${b.name}" ready. Ask for it any time.`;
          onLearned(b.name);
          teaching.dataset.detail = b.code;
          if (debug) { const sp = document.createElement('span'); sp.className = 'detail'; sp.textContent = b.code; teaching.appendChild(sp); }
          carryOut(ships.length ? ships : [flagship()], { op: 'behaviour', id: b.id, name: b.name }, 'sure');
        } catch (e) {
          teaching.className = 'line refused';
          teaching.querySelector('.progress')?.remove();
          (teaching.querySelector('.text') as HTMLSpanElement).textContent = `${String(e)}`;
        }
        return;
      }
      if (!d.command || d.intent === 'none') { line('refused', flagship(), 'Say again, captain?'); return; }
      const t = tier(d.confidence);
      if (t === 'refused') { line('refused', speaker, `Say again, captain? ${weakest(d)}`); return; }
      if (!ships.length) { line('refused', flagship(), `No ship called ${d.ship}.`); return; }
      if (d.command.op === 'report') { for (const s of ships) line('info', s, report(s)); return; }
      carryOut(ships, d.command, t);
    } catch (e) { line('refused', null, String(e)); }
  };

  const weakest = (d: Dispatch) => {
    const names: Record<string, string> = { ship: 'Which ship?', intent: 'What order?', turnAmount: 'Turn how far?', climbAmount: 'How far?', station: 'Which station?', crewCount: 'How many?', speedLevel: 'What speed?', turnDir: 'Which way?', climbDir: 'Up or down?' };
    let k = 'intent', best = 2;
    for (const [name, a] of Object.entries(d.answers)) if (a.confidence < best && name in names) { best = a.confidence; k = name; }
    return names[k];
  };

  const submit = (text: string) => {
    text = text.trim();
    if (!text) return;
    if (text.startsWith('/')) {
      line('info', null, text);
      const c = parse(text.slice(1));
      if ('error' in c) line('refused', null, c.error); else carryOut([flagship()], c, 'sure');
      return;
    }
    void viaJev(text);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const text = input.value; input.value = ''; submit(text);
  });
  addEventListener('keydown', (e) => {
    if (document.activeElement === input) return;
    if (e.key === 'Enter') { input.focus(); e.preventDefault(); }
    if (e.key.toLowerCase() === 'd') {
      debug = !debug;
      log.classList.toggle('debug', debug);
      log.querySelectorAll<HTMLDivElement>('.line').forEach((l) => {
        if (l.dataset.detail && !l.querySelector('.detail')) { const sp = document.createElement('span'); sp.className = 'detail'; sp.textContent = l.dataset.detail; l.appendChild(sp); }
      });
    }
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); });
  line('info', flagship(), 'Bridge ready, captain. Press Enter and give an order.');
  return { line, submit };
}
