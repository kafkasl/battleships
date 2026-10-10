// Order log: one line per ship per order, built for a glance: badge in the ship's colour, a
// crew-voice readback, and a confidence tier shown as a colour bar. D toggles the debug detail.
import { parse, execute, report } from './commands';
import { dispatch, type Roster, type Dispatch, type Learned, type Order } from './jev';
import { behaviours } from './behaviours';
import { learn, forgetAll } from './academy';
import type { Sim, Ship } from './sim';

export interface Addressing {
  roster: Roster;                                   // label -> description, sent to Jev
  resolve: (label: string) => Ship[];               // label -> ships to order
}

type Tier = 'sure' | 'hedge' | 'refused' | 'info' | 'academy' | 'learned';
// Orders are obeyed down to 40%: a hedged readback beats a refusal when the captain is only giving a few.
const tier = (conf: number): Tier => (conf >= 0.6 ? 'sure' : conf >= 0.4 ? 'hedge' : 'refused');

const learned = (): Learned => Object.fromEntries([...behaviours.values()].filter((b) => b.id !== 'engage').map((b) => [b.id, { description: b.description, name: b.name }]));

export function installConsole(sim: Sim, flagship: () => Ship, addressing: () => Addressing,
                               onOrder: (ship: Ship) => void, onLearned: (name: string) => void = () => {}) {
  const box = document.createElement('div');
  box.id = 'console';
  box.innerHTML = `<div id="log"></div><div id="chips"></div><input id="cmd" placeholder="type or dictate an order, then Enter" autocomplete="off" />`;
  document.body.appendChild(box);
  const log = box.querySelector('#log') as HTMLDivElement;
  const input = box.querySelector('#cmd') as HTMLInputElement;
  const chips = box.querySelector('#chips') as HTMLDivElement;
  // "Add manoeuvre" arms the next order: if the ships cannot do it, the academy writes it. One shot.
  // Saying "teach: …" does the same without the button.
  let armed = false;
  const arm = document.createElement('button');
  arm.id = 'academy-toggle';
  const paintArm = () => {
    arm.textContent = armed ? '◆ describe the manoeuvre…' : '+ Add manoeuvre';
    arm.classList.toggle('on', armed);
    input.placeholder = armed ? 'describe the manoeuvre, e.g. "fighters, stay behind Mother"' : 'type or dictate an order, then Enter';
  };
  arm.addEventListener('click', () => { armed = !armed; paintArm(); if (armed) input.focus(); });
  paintArm();
  chips.appendChild(arm);
  const forget = document.createElement('button');
  forget.id = 'forget';
  forget.textContent = '✕ clear manoeuvres';
  forget.title = 'forget every learned manoeuvre';
  forget.addEventListener('click', () => { forgetAll(); location.reload(); });
  chips.appendChild(forget);
  // Tappable example orders: a stranger (or a phone) can play without typing a word.
  for (const text of ['all ships, engage the enemy', 'fighters, stay behind Mother', 'frigates, circle the Dragon while firing', 'all ships, belay that', 'all ships report']) {
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

  const carryOut = (ships: Ship[], orders: Order[], t: Tier) => {
    for (const c of orders) {
      if (c.op === 'report') { for (const s of ships) line('info', s, report(s)); continue; }
      for (const s of ships) {
        const r = execute(s, c);
        line(r.ok ? t : 'refused', s, r.ok ? (t === 'hedge' ? r.msg.replace(/\.$/, '?') : r.msg) : r.reason);
        if (r.ok) onOrder(s);
      }
    }
  };

  const detailOf = (d: Dispatch) => {
    const top = (k: string, n = 2) => Object.entries(d.answers[k]?.probabilities ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([l, p]) => `${l} ${Math.round(p * 100)}%`).join(' / ');
    const fleet = Math.round(((d.answers.fleet as unknown as { noul: number })?.noul ?? 0) * 100);
    return `ship ${top('ship')}${d.ships.length > 1 ? ' +' + d.ships.slice(1).join(',') : ''} · fleet ${fleet}% · intent ${top('intent')} · weakest ${d.weakest} ${Math.round(d.confidence * 100)}% · ${Math.round(d.latency)} ms · ${JSON.stringify(d.command)}`;
  };

  const viaJev = async (text: string) => {
    onOrder(flagship()); // any order starts the match clock
    let teach = armed;
    const tm = text.match(/^\s*(teach|academy|learn)[:,]?\s+(.*)$/i);
    if (tm) { teach = true; text = tm[2]; }
    if (armed) { armed = false; paintArm(); }
    const pending = line('info', null, text);
    const { roster, resolve } = addressing();
    try {
      // With "+ Add manoeuvre" armed (or "teach:"), the sentence IS the manoeuvre: straight to the academy,
      // addressed to whoever Jev thinks it names.
      const d = await dispatch(text, roster, [...sim.ships.values()].map((s) => s.name), learned());
      if (teach) {
        d.intent = 'unsupported';
        // A manoeuvre description is long and mentions several ships; only a sure fleet signal means "everyone".
        const fleet = (d.answers.fleet as unknown as { noul: number } | undefined)?.noul ?? 0;
        if (d.ships.includes('all') && fleet < 0.85) d.ships = [d.answers.ship.choice];
      }
      if (debug) pending.insertAdjacentHTML('beforeend', '<span class="detail"></span>');
      const det = pending.querySelector('.detail') as HTMLSpanElement | null;
      if (det) det.textContent = detailOf(d);
      pending.dataset.detail = detailOf(d);
      const seen = new Set<string>();
      const ships = d.ships.flatMap(resolve).filter((s) => !seen.has(s.id) && seen.add(s.id));
      const speaker = ships[0] ?? flagship();
      // Understood but impossible is a different answer from not understood. Send it to the academy:
      // Opus writes the manoeuvre once, the ships run it, and from now on Jev routes to it directly.
      if (d.intent === 'unsupported') {
        // The yes/no questions may have caught the real order ("move forward") even when the choice went astray.
        if (ships.length && d.extras.length) { carryOut(ships, d.extras, 'sure'); if (!teach) return; }
        if (!teach) { line('refused', speaker, "Understood, captain, but we don't know how to do that. Press Add manoeuvre, or say \"teach: …\"."); return; }
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
          carryOut(ships.length ? ships : [flagship()], [{ op: 'behaviour', id: b.id, name: b.name }], 'sure');
        } catch (e) {
          teaching.className = 'line refused';
          teaching.querySelector('.progress')?.remove();
          (teaching.querySelector('.text') as HTMLSpanElement).textContent = `${String(e)}`;
        }
        return;
      }
      if (!d.command || d.intent === 'none') {
        // The choice found nothing, but a yes/no may have ("kestrel heron stop" with the vote split three ways).
        if (ships.length && d.extras.length) { carryOut(ships, d.extras, 'hedge'); return; }
        line('refused', flagship(), 'Say again, captain?'); return;
      }
      const t = tier(d.confidence);
      if (t === 'refused') { line('refused', speaker, `Say again, captain? ${weakest(d)}`); return; }
      if (!ships.length) { line('refused', flagship(), `No ship called ${d.ship}.`); return; }
      carryOut(ships, [d.command, ...d.extras], t);
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
    if (text === '/forget') { forgetAll(); location.reload(); return; }
    if (text.startsWith('/')) {
      line('info', null, text);
      const c = parse(text.slice(1));
      if ('error' in c) line('refused', null, c.error); else carryOut([flagship()], [c], 'sure');
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
    if (e.key === '`') {
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
