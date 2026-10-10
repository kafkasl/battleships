# Battlefleet — Plan

Voice-commanded space battle game. Homeworld / Battlefleet Gothic look. Hackathon scope.
Edit this file freely; it is the source of truth for decisions.

## 1. Vision

- You captain one (initially) or multiple ships in a range of scenarios (first a nebula). You talk to it; Jev turns speech into commands.
- Ships have stations (engines, sensoria, analysis, weapons) and not enough crew to man them all.
  Where you assign crew decides what you can do and what you can see.
- As sensors come online you can program per-ship behaviours ("if a contact is closer than
  200 and is an enemy, fire and turn right"). Rules are data and run every tick without Jev.
- Enemy ships run the same rule engine. A battle happens.

## 2. Visual stack (step 1 of derisking)

| Piece | Choice |
|---|---|
| Renderer | Three.js + Vite, TypeScript |
| Post-processing | `postprocessing` (pmndrs): bloom, vignette, SMAA, later god rays / chromatic aberration |
| Particles | `three.quarks` (engine trails, explosions, debris) |
| Background | Procedural nebula shader on a sky sphere + star point cloud + one huge bright light source bleeding into frame |
| Ships | Quaternius Ultimate Space Kit (CC0, GLB). Emissive engine glows and hull lights added in code |
| Depth | Fog tinted to the nebula colour so distant ships fade into it |
| Camera | Mouse: orbit / pan / zoom (OrbitControls with damping), default target = your flagship, free to roam |

What sells the look is bloom + nebula + additive beams + swarm of small ships + slow camera.
Models matter less than lighting. Build the look first, judge it, then continue.

## 3. Architecture

Three layers, strictly separated:

1. **Sim** — plain data, fixed tick (e.g. 20 Hz). No Three.js imports. Testable in Node.
2. **Renderer** — reads sim state each frame, owns all visuals. Never changes gameplay state.
3. **Command API** — the only way to change the sim. Called by the debug text box, by Jev, and by rules.

### Ship state

```ts
type Ship = {
  id: string; name: string;           // "Vigilant", "Alpha 2" — names are how voice refers to ships
  type: ShipTypeId;                    // config: model file, hardpoints, speedMax, turnRate, stations
  faction: 'player' | 'enemy' | 'neutral';
  pos: Vec3; heading: number;          // degrees, 2D plane for gameplay; render adds banking/pitch for looks
  speed: number;                       // actual, 0..1
  desiredSpeed: number; desiredHeading: number; desiredAltitude: number;   // sim eases toward these at fixed rates
  hull: number;
  crew: number;                        // total available
  stations: Record<StationId, number>; // crew assigned per station
  rules: Rule[];                       // this ship's "Jev" behaviours
  contacts: Contact[];                 // what THIS ship currently knows
};
```

Movement is kinematic: desired speed + desired heading + desired altitude. No momentum.
Heavier ships get lower speedMax / turnRate / climbRate in their type config.
Altitude is the Homeworld 3D touch: voice makes it cheap ("climb 50", "dive to grid level"),
and each ship draws a drop line to its shadow on the grid.

### Stations (gate everything)

| Station | Unlocks |
|---|---|
| engines | set speed, set heading, climb / dive |
| sensoria | contacts within radius R appear (as unresolved returns) |
| analysis | contacts get classified: rock / ship / enemy / friendly |
| weapons | fire at target |

A command whose station is unmanned is rejected with a reason code so Jev / the UI can say
"nobody is on engines, captain".

### Contacts and fog of war

The renderer shows what the flagship knows, not ground truth.
- Outside sensor range: nothing.
- Inside range, analysis unmanned: glowing sensor return (blob/sprite).
- Classified: resolves to the actual model.
Build this in step 2 so it is designed with the post-effects, not bolted on.

### Command API (all closed vocab, no free text)

```
setSpeed(ship, level)           level: stop | slow | half | full
turn(ship, dir, amount)         dir: left | right ; amount: 15 | 30 | 45 | 90 | 180
setHeading(ship, deg)
climb(ship, amount) / setAltitude(ship, y)    amount buckets: 25 | 50 | 100 ; negative = dive
fire(ship, target?)
assignCrew(ship, station, n)    or moveCrew(ship, from, to)
addRule(ship, rule) / removeRule(ship, idx) / listRules(ship)
```

### Rules (per-ship behaviours)

```ts
type Rule = { when: Trigger; then: Action[] };
Trigger = { contact: 'any' | 'rock' | 'ship' | 'enemy'; within: number }
Action  = one Command API call with fixed args (e.g. turn right 45, fire, setSpeed full)
```

Evaluated every tick against ship.contacts. Triggers can only reference what manned
stations produce (no 'enemy' trigger without analysis). Unlocking a station unlocks vocabulary.

## 4. Jev integration

**What Jev is:** a classifier, not a chat model. `POST https://api.typesafe.ai/v1/systemone`
with `state` (text) + `questions` (named Choice / Score / Noul questions) → answers with
confidence and per-option probabilities. JS SDK: `npm i @typesafe-ai/sdk`,
`client.systemOne({ state, questions: { x: choice("...", { a: null, b: null }) } })`.
Env var `TYPESAFE_API_KEY`. Docs: https://docs.typesafe.ai/llms.txt

**Pipeline:**

1. Browser Web Speech API (`webkitSpeechRecognition`) → transcript. Push-to-talk key.
2. One `systemOne` call with the transcript as `state` and a fixed question set:
   - `intent`: choice over { setSpeed, turn, fire, assignCrew, addRule, listRules, none }
   - `ship`: choice over current ship names + "flagship"
   - `speedLevel`, `turnDir`, `turnAmount`, `climbDir`, `climbAmount`, `station`, `triggerKind`, ... : one choice per closed-set argument
   - `stated_<arg>`: noul "did the user mention <arg>?" so defaults apply when unmentioned
3. Dispatcher (same pattern as the TypeSafe function-calling cookbook) reads only the answers
   relevant to the chosen intent, builds the Command API call, checks confidence.
   Low confidence on the weakest argument → the ship asks back ("turn how much?").
4. Numbers: Jev cannot extract free numbers. Use buckets (15/30/45/90/180, 100/200/500 m)
   or regex the transcript for digits as a pre-pass.

**Key handling:** during the hackathon, Vite dev proxy `/jev` → `api.typesafe.ai` adding the
Authorization header server-side, so the key never ships to the browser. Swap for a tiny
Node proxy if deployed.

**Open question to verify in step 4:** latency per call (docs make no claim). If it is
sub-second, voice feels instant. If not, show a "processing" cue on the HUD.

## 5. Status (time is short: demo first)

DONE
- Visuals: nebula, bloom, grid, procedural capital ships and frigates, Quaternius fighters, travelling beams.
- Sim: kinematic ships (speed / heading / altitude), crew stations gating commands, contacts from sensors.
- Jev: typed orders (dictate with MacWhisper) → one Command. Addressing by name, class, group or fleet.
  Crew-voice readbacks, confidence tiers (green / amber / red), D debug toggle, ship card on hover/click.
- Fleet: Vigilant (capital), Kestrel + Heron (frigates), Alpha 1-3 (fighters). Enemy: Ravager + escorts.

- Combat: weapons free, 270° firing arc (90° cone astern is blind), range arcs on the grid, hull bars, enemy
  return fire, explosions, dead ships removed.
- Academy: an order the ships cannot carry out goes to Opus (`src/academy.ts`), which writes a behaviour
  (`src/behaviours.ts`: a function run every tick against a tiny API). It is applied at once and becomes a new
  Jev intent, so the next "frigates, circle them too" routes in ~300 ms with no LLM in the loop.
  "belay that" cancels. A crash says "I'm too dumb for that, captain." Learned manoeuvres persist in
  localStorage; a rehearsed "Clockwise Orbit" is baked in as a fallback if the API is down on stage.

NOT DONE, in demo-value order
1. Rehearse the demo script below three times with the real phrases. Note any misroutes and fix descriptions.
2. Enemy doctrine: Ravager and raiders hold position and track the nearest ship. Good enough for the demo.
3. Polish if time remains: hit sparks, camera shake, sound, wreck debris.

CUT for the demo: bridge-staffing confidence mechanic, follow-up questions on low confidence, saving rules,
multiple player capital ships, 3D rule triggers (above / below).

## 6. Demo script: "why are we still clicking?"

Three runs, one sentence each. Open the stage laptop at `http://localhost:5173/?stage` so no manoeuvre is remembered.
Ship names: Mother (capital), Red and Blue (frigates), Eagle 1-3 (fighters). The enemy mirrors it: Dragon, Fang, Claw, Drone 1-3,
all advancing at a steady half speed with guns free. 60-second clock; a timeout is a defeat.

1. **Run 1.** Say: `All ships, full ahead and shoot the enemy.`
   Every ship answers "Weapons free." then "Full ahead." Both fleets charge and pass through each other; ours sail on with
   the enemy astern in the blind cone and stop firing. The clock runs out: "the Dragon got away". A loss. Save the score.
2. **Run 2.** Play again. Say: `Mother and frigates, engage the enemy.`
   Engage is the built-in manoeuvre: close, keep the target ahead or abeam, keep shooting. Win in about 35 s, heavy losses.
3. **Run 3.** Play again. Same order as run 2. Then press **+ Add manoeuvre** and say:
   `Eagles, stay behind Mother and shoot anything in range.`
   Eagle 1: "we don't know how to do that yet." Violet academy line for ~10 s. "New manoeuvre ready." Each eagle: "aye."
   The eagles fall in astern of Mother and fire from cover. Expect a faster win and a higher place on the board.

While the academy works: "that manoeuvre did not exist a moment ago. From now on 'eagles, stay behind Mother' routes to
it in 300 ms through the classifier. No LLM in the game loop."

Optional fourth sentence once it exists: `Frigates, circle the Dragon while firing.` (also a taught manoeuvre).

Fallbacks: speech-to-text mangles a name → type it. Academy down → the rehearsed manoeuvre loads under the same phrase.
A manoeuvre misbehaves → `Eagles, belay that.` Backtick shows the debug line (ship and intent probabilities, latency).
Routing regression suite: `npm test` (23 phrases against the live Jev API).

## 7. Decisions made

- Single flagship for the player plus named escorts. Camera defaults to the flagship.
- Kinematic movement (desired speed / heading / altitude), not acceleration.
- Ship names are the voice handle; every ship gets a readable name. "all ships" is its own yes/no question
  to Jev because an "all" option inside the ship question soaked up "all ahead" and "all stop".
- Tiers use the chosen option's probability, not Jev's separate confidence field.
- Rules are data (JSON), shown on screen and readable back by voice.
- Jev never sits inside the game loop; it only translates one utterance into one command.
- No browser speech-to-text; the text box is dictated into with MacWhisper.
1