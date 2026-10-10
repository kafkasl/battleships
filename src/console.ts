// Order log: one line per ship per order, built for a glance: badge in the ship's colour, a
// crew-voice readback, and a confidence tier shown as a colour bar. D toggles the debug detail.
import { parse, execute, report } from './commands';
import { dispatch, type Roster, type Dispatch } from './jev';
import type { Sim, Ship, Command } from './sim';

export interface Addressing {
  roster: Roster;                                   // label -> description, sent to Jev
  resolve: (label: string) => Ship[];               // label -> ships to order
}

type Tier = 'sure' | 'hedge' | 'refused' | 'info';
const tier = (conf: number): Tier => (conf >= 0.7 ? 'sure' : conf >= 0.45 ? 'hedge' : 'refused');

export function installConsole(sim: Sim, flagship: () => Ship, addressing: () => Addressing,
                               onOrder: (ship: Ship) => void) {
  const box = document.createElement('div');
  box.id = 'console';
  box.innerHTML = `<div id="log"></div><input id="cmd" placeholder="full ahead · Alpha 2 hard to port · fighters climb 40 · Kestrel, man the sensors · all ships report" autocomplete="off" />`;
  document.body.appendChild(box);
  const log = box.querySelector('#log') as HTMLDivElement;
  const input = box.querySelector('#cmd') as HTMLInputElement;
  let debug = false;

  const line = (t: Tier, ship: Ship | null, text: string, detail = '') => {
    const d = document.createElement('div');
    d.className = `line ${t}`;
    const badge = ship ? `<span class="badge" style="color:${ship.color};border-color:${ship.color}">${ship.name}</span>` : '<span class="badge you">You</span>';
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
    return `ship ${top('ship')} · intent ${top('intent')} · weakest ${d.weakest} ${Math.round(d.confidence * 100)}% · ${Math.round(d.latency)} ms · ${JSON.stringify(d.command)}`;
  };

  const viaJev = async (text: string) => {
    const pending = line('info', null, text);
    const { roster, resolve } = addressing();
    try {
      const d = await dispatch(text, roster, [...sim.ships.values()].map((s) => s.name));
      if (debug) pending.insertAdjacentHTML('beforeend', '<span class="detail"></span>');
      const det = pending.querySelector('.detail') as HTMLSpanElement | null;
      if (det) det.textContent = detailOf(d);
      pending.dataset.detail = detailOf(d);
      if (!d.command || d.intent === 'none') { line('refused', flagship(), 'Say again, captain?'); return; }
      const t = tier(d.confidence);
      if (t === 'refused') { line('refused', flagship(), `Say again, captain? ${weakest(d)}`); return; }
      const ships = resolve(d.ship);
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
  return { line };
}
