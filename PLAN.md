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

NOT DONE, in demo-value order
1. Combat that matters. "Fire" does nothing yet; beams are decorative. Needs: fire at nearest
   known enemy contact, hull damage, ship death with an explosion. Without this there is no battle.
2. Contact rendering (fog of war). Enemies only visible as glowing returns inside sensor range, resolving
   to models when analysis is manned. This is the crew mechanic made visible, and the best demo moment:
   "man the sensors" and the enemy appears.
3. Rules. "If an enemy is within 200, fire and turn right." Enemy ships run rules too. Cut to the simplest
   form if time is short: one trigger (enemy within X), one or two actions.
4. Polish: explosions, hit sparks, camera shake, sound.

CUT for the demo: bridge-staffing confidence mechanic, follow-up questions on low confidence, saving rules,
multiple player capital ships, 3D rule triggers (above / below).

## 6. Demo script (3 minutes)

1. Open on the fleet in the nebula. Orbit the camera. "This is Battlefleet: you command by voice."
2. "Vigilant, full ahead." Readback, ship moves, ring pulses. "Fighters, climb 50." Drop lines rise.
3. "All ships report." Crew voice status. Show the ship card on hover.
4. "Man the sensors." Enemy returns appear as glows. "Put one on analysis." They resolve into Ravager and escorts.
5. "Fighters, if an enemy comes within 200, fire." Rule stored, shown. Enemy closes. Fighters open up.
6. Press D once: "every order is one Jev call, 300 ms, closed-choice questions, no LLM in the loop."
7. Ravager dies in a bloom of fire. End on the wreck drifting past the grid.

Fallbacks: if speech-to-text misbehaves, type the orders. If Jev misroutes, say the ship name first.

## 7. Decisions made

- Single flagship for the player plus named escorts. Camera defaults to the flagship.
- Kinematic movement (desired speed / heading / altitude), not acceleration.
- Ship names are the voice handle; every ship gets a readable name. "all ships" is its own yes/no question
  to Jev because an "all" option inside the ship question soaked up "all ahead" and "all stop".
- Tiers use the chosen option's probability, not Jev's separate confidence field.
- Rules are data (JSON), shown on screen and readable back by voice.
- Jev never sits inside the game loop; it only translates one utterance into one command.
- No browser speech-to-text; the text box is dictated into with MacWhisper.
