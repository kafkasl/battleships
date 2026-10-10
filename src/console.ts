// Debug console: a text box that drives the Command API. Stand-in for Jev until step 4.
import { parse, execute, status } from './commands';
import type { Sim, Ship } from './sim';

export function installConsole(sim: Sim, getShip: () => Ship) {
  const box = document.createElement('div');
  box.id = 'console';
  box.innerHTML = `<div id="log"></div><input id="cmd" placeholder="speed full · turn left 30 · climb 50 · crew sensoria 1 · status" autocomplete="off" />`;
  document.body.appendChild(box);
  const log = box.querySelector('#log') as HTMLDivElement;
  const input = box.querySelector('#cmd') as HTMLInputElement;
  const say = (s: string, cls = '') => {
    const d = document.createElement('div');
    d.textContent = s; d.className = cls;
    log.appendChild(d);
    while (log.children.length > 8) log.removeChild(log.firstChild!);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const text = input.value; input.value = '';
    if (!text.trim()) return;
    say('> ' + text, 'in');
    if (text.trim() === 'status') { say(status(getShip())); return; }
    const c = parse(text);
    if ('error' in c) { say(c.error, 'err'); return; }
    const r = execute(getShip(), c);
    say(r.ok ? r.msg : r.reason, r.ok ? 'ok' : 'err');
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement !== input) { input.focus(); e.preventDefault(); }
    if (e.key === 'Escape') input.blur();
  });
  say('press Enter to type a command', 'ok');
  return { say };
}
