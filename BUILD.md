# How Battlefleet was built

13-hour hackathon, one person plus one coding agent.

## Models and what each one does

| Model | Role | Latency | Where |
|---|---|---|---|
| Jev (TypeSafe `jev-latest`) | Turns every order into a command: closed-choice questions for intent, ship, speed level, turn direction and amount; one yes/no per action and per addressee so compound orders work. No free text, no generation. | ~300 ms | `src/jev.ts` |
| Claude Opus 5.5 | The academy. Writes a new manoeuvre (a JavaScript function against a 12-call API) from one sentence. Called only when the player asks to teach something. | ~10 s | `src/academy.ts` |
| Claude Fable 5.1 (Claude Code) | Built the game: renderer, sim, command API, Jev dispatcher, academy, UI, tests. | | this repo |
| MacWhisper | Speech to text on the player's machine, typing into the order box. | | |

No LLM runs inside the game loop. Jev is a classifier, so one utterance is one request with ~30 small questions. Opus runs once per new manoeuvre; the result is cached in the browser and routed to by Jev from then on.

## What the agent did versus by hand

Agent (Claude Code): all source files, the procedural capital ship, the nebula shader, the Jev question design and threshold tuning (tested against the live API from a Python kernel), the behaviour API and Opus prompt, headless-browser rehearsals of every demo phrase, commits.

By hand: product direction and every design decision in `PLAN.md` (voice-only control, crew stations, altitude as a third primitive, no fog of war for the demo, the match loop and leaderboard, the academy as a one-shot button), playtesting with real dictation and reporting what misrouted, the demo script.

## The three demo orders

1. `All ships, full ahead and shoot the enemy.`
2. `Mother and frigates, engage the enemy.`
3. **+ Add manoeuvre** then `Eagles, stay behind Mother and shoot anything in range.`

## Setup

```
npm install
export TYPESAFE_API_KEY=...   # Jev
export ANTHROPIC_API_KEY=...  # academy
npm run dev                   # http://localhost:5173 ; add ?stage to start with no learned manoeuvres
```

Both keys stay on the dev server: Vite proxies `/jev` and `/claude` and adds the headers.

Assets: Quaternius Ultimate Space Kit (CC0) for fighters and rocks; capital ships and frigates are generated in `src/capital.ts`.

Tokens: see the Claude Code session cost. (Fill in before the pitch.)
