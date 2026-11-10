# Learner Lane — architecture

Learner Lane is a static, client-only web app (Vite + TypeScript + three.js) that
teaches people to drive and prepares them for their driving test. It is deployed
to GitHub Pages; there is no server and no account system — progress lives in
`localStorage`.

## 1. Layers

```
src/core/           shared types + tiny pure helpers (math, rng, events, units, constants)
src/jurisdictions/  rule profiles (pure data)                         ── headless
src/world/          town map, road network, routing, signals, scenery ── headless
src/sim/            vehicle physics, player car, traffic, pedestrians,
                    collisions, environment, session                  ── headless
src/rules/          fault catalogue, rule monitor, scoring            ── headless
src/scenarios/      lessons, skill drills, mock tests, autopilot      ── headless
src/theory/         question banks + quiz logic                       ── headless
src/signs/          road-sign artwork as SVG strings                  ── headless (string output)
────────────────────────────────────────────────────────────────────────────────
src/render/         three.js scene, cameras, mirrors, weather         ── browser
src/input/          keyboard, gamepad, touch                          ── browser
src/audio/          WebAudio + speech synthesis                       ── browser
src/ui/             DOM screens, HUD, styles                          ── browser
src/app/            top-level app state machine + game loop           ── browser
```

**Hard rule:** everything above the line is *headless*: it must not import
`three`, touch `window`/`document`, or use `Math.random()` / `Date.now()` /
`performance.now()`. All randomness comes from the session `Rng`
(`src/core/rng.ts`), all time from `ctx.time`. This is what lets the whole
simulation — including a perfect-driver autopilot — run inside vitest.

Headless code is covered by unit tests next to the source (`foo.test.ts`).

## 2. Conventions

* TypeScript strict mode, ES modules, `verbatimModuleSyntax` is on → use
  `import type { … }` for type-only imports. Relative imports, no path aliases,
  no file extensions.
* SI units inside the simulation (m, s, m/s, rad). Convert only at the UI edge
  with `src/core/units.ts`.
* Coordinates (also documented at the top of `src/core/types.ts`):
  * ground plane is X/Z, Y is up; **North = −Z, East = +X**.
  * heading `h`: forward = `(sin h, cos h)`; `h = 0` faces South (+Z), `π/2` East,
    `π` North, `−π/2` West. three.js meshes are modelled facing **+Z** and
    oriented with `rotation.y = h`.
  * right vector = `(−cos h, sin h)`; **turning right decreases heading**.
  * `steer` and `lateral` values are **positive to the right**.
  * Use the helpers in `src/core/math.ts` (`forwardOf`, `rightOf`, `toLocal`,
    `fromLocal`, `headingOf`, `angleDiff`, `obbOverlap`…) instead of re-deriving.
* A vehicle's `x`/`z` is the **centre of its footprint**.
* "Kerb side" / "near side" = right when driving on the right, left when
  driving on the left. Never hard-code a side: derive it from
  `profile.drivingSide` / `network.side`.
* User-facing text uses the jurisdiction's vocabulary via `profile.terms`
  (e.g. "indicator" vs "turn signal", "give way" vs "yield", "kerb" vs "curb").
  Spelling follows the jurisdiction where practical.
* No new runtime dependencies beyond `three`. No network requests at runtime
  (no CDNs, no web fonts): the site must work offline once loaded.
* Accessibility is a product goal: full keyboard operation of every menu,
  visible focus, ARIA labels, respects `prefers-reduced-motion`, never encodes
  information by colour alone, touch targets ≥ 44 px.

## 3. Shared contracts

`src/core/types.ts` defines every cross-module data shape. Read it first. Do not
change an existing field's meaning; if a module needs something extra, add an
optional field and mention it in your hand-off notes.

### Simulation tick (fixed step `SIM_DT` = 1/60 s)

```
1. input            → ControlInput
2. player car       → updatePlayerCar()            (src/sim/playerCar.ts)
3. locate           → player.location = network.locate(player position)
4. signals          → ctx.signals.update(dt)
5. traffic          → traffic.update(ctx, dt)      AI vehicles
6. pedestrians      → pedestrians.update(ctx, dt)
7. collisions       → resolve + emit 'collision'
8. scenario         → scenario.update(ctx, dt)     objectives / instructions
9. rules            → monitor.update(ctx, dt)      emits 'fault' / 'praise'
```

`SimContext` (types.ts) is the shared blackboard that every subsystem reads and
mutates; subsystems communicate outward through `ctx.events`.

## 4. The town ("Maple Grove")

One hand-authored town is shared by every mode. It is a grid so that all roads
are axis-aligned and every bend happens inside a junction.

```
            A        B        C        D        E        F
 x =      -275     -165      -55       55      165      275

 1 (z=-220) ┌────────┬────────┬────────┬────────┬────────┐   Northgate Road   (urban)
            │        │        │        │        │        │
 2 (z=-110) ├────────■━━school━○────────┼────────◎────────┤   Maple Street     (residential)
            │        │        │        │        │        │
 3 (z=0)    ╞════════╪════════╪════════╪════════╪════════╡   Main Street      (arterial, 2 lanes each way)
            │        │        │        │        │        │
 4 (z=110)  ├─park───■────────◎────────┼──[lot]─■────────┤   Orchard Lane     (residential)
            │        │park    │        │        │        │
 5 (z=220)  └────────┴────────┴────────┴────────┴────────┘   Southfield Road  (urban)

          West Ave  Birch St Cedar St Station Rd Elm St  East Ave
          (urban)   (resid.) (resid.)  (urban)  (resid.) (urban)
```

Node id = column letter + row number (`C3`). Every pair of adjacent nodes is
joined by a road (grid is complete: 6 × 5 nodes, 49 road segments).

| Node(s) | Control | Notes |
|---|---|---|
| A1, F1, A5, F5 | `none` | corner bends |
| B1, D1, E1 | `stop_minor` (minor NS) | T-junctions onto Northgate Road |
| C1 | `yield_minor` (minor NS) | |
| C5, D5 | `stop_minor` (minor NS) | T-junctions onto Southfield Road |
| B5, E5 | `yield_minor` (minor NS) | |
| A2, F4 | `stop_minor` (minor EW) | T-junctions onto West/East Avenue |
| A4, F2 | `yield_minor` (minor EW) | |
| A3, B3, D3, E3, F3 | `signal` | Main Street |
| C3 | `stop_minor` (minor NS) | Cedar Street crosses 4-lane Main Street |
| B2 | `allway_stop` (minorAxis NS) | |
| B4 | `allway_stop` (minorAxis EW) | |
| E4 | `allway_stop` (minorAxis NS) | |
| C2 | `uncontrolled` | priority rule depends on jurisdiction |
| D2, D4 | `stop_minor` (minor EW) | residential streets meet Station Road |
| E2, C4 | `roundabout` | single-lane, four arms |

Roads: rows 1 & 5 and columns A, D, F are `urban`; rows 2 & 4 and columns B, C, E
are `residential`; row 3 (Main Street) is `arterial` with `lanes: [2, 2]`;
everything else is `[1, 1]`. Maple Street between B2 and C2 is the school zone
(`speedClass: 'school'`, `midblockCrossing: 0.5`). Station Road between D4 and
D5 has a mid-block crossing at 0.5. Parking strips: Orchard Lane A4–B4, Birch
Street B4–B5, Maple Street A2–B2.

The **Test Centre** car park (`ZoneDef`, id `test_centre`) sits in the block
bounded by D4/E4/D5/E5 with its driveway joining Orchard Lane (D4–E4). It has
marked bays (`BayDef`, 2.6 m × 5.2 m) and is where mock tests start and finish
and where bay parking is practised. AI traffic never enters zones.

Dimensions live in `src/core/constants.ts` (lane 3.4 m, parking strip 2.4 m,
sidewalk 2.6 m, crosswalk 3 m, roundabout island radius 7 m + 5 m lane).

### Road network derivation (`buildRoadNetwork`)

* The carriageway is centred on the road axis. Lanes are numbered from the
  centre line outward (`index 0` = nearest the centre line). Which physical side
  a direction of travel uses comes from `profile.drivingSide`.
* A lane runs from just clear of its `from` junction to the **stop/yield line**
  of its `to` junction (`lane.end` is ON the line). Marked crosswalks at
  junctions (signal and all-way-stop nodes, every arm) lie between the stop line
  and the junction box, i.e. on the connectors.
* Connectors are sampled polylines through the junction. Lane discipline:
  kerb-side turns go from the kerb-most lane into the kerb-most lane; turns
  across oncoming traffic go from the centre-most lane into the centre-most
  lane; straight-on keeps the same lane index (clamped). No U-turn connectors.
* A roundabout movement is ONE connector from the entry yield line, around the
  ring (anticlockwise when driving on the right, clockwise when driving on the
  left) to the start of the exit lane, with `exitNumber` set.
* `allway_stop` nodes become `yield_minor` when `rules.allWayStops` is false.
* Speed limits come from `profile.speedLimits[speedClass]`, converted to m/s.

## 5. Module ownership

Each module has one owner; do not edit files outside your module (ask for a
contract change in your hand-off notes instead).

| Path | Exports (public API) |
|---|---|
| `src/world/town.ts` | `TOWN: MapDef` |
| `src/world/network.ts` | `buildRoadNetwork(map, profile): RoadNetwork`, `validateMap(map): string[]` |
| `src/world/routing.ts` | `findRoute(net, fromLaneId, toLaneId, opts?): RouteLeg[] \| null`, `routePolyline(net, legs, fromS?, toS?): Vec2[]`, `routeLength(net, legs): number` |
| `src/world/signals.ts` | `createSignalSystem(net, profile): SignalSystem` |
| `src/world/scenery.ts` | `generateScenery(net, seed): SceneryLayout` (pure layout: buildings, trees, lamps → also static obstacles) |
| `src/sim/vehicle.ts` | `createVehicle(...)`, `stepVehicle(v, cmd, dt, grip)`, `vehicleObb(v, margin?)`, AI/parked specs |
| `src/sim/playerCar.ts` | `createPlayerCar(pose): PlayerCar`, `updatePlayerCar(ctx, input, dt)` |
| `src/sim/collision.ts` | `resolveCollisions(ctx): void` (emits `collision`) |
| `src/sim/environment.ts` | `createEnvironment(settings, profile): EnvironmentState` |
| `src/sim/traffic.ts` | `createTraffic(ctx): { update(ctx, dt): void }` |
| `src/sim/pedestrians.ts` | `createPedestrians(ctx): { update(ctx, dt): void }` |
| `src/sim/session.ts` | `createSession(opts): Session` — owns the tick order above |
| `src/rules/catalog.ts` | `FAULTS: Record<FaultCode, FaultSpec>` |
| `src/rules/monitor.ts` | `createRuleMonitor(ctx, opts): RuleMonitor` |
| `src/rules/scoring.ts` | `scoreFaults(faults, profile): ScoreSummary`, `starsFor(...)` |
| `src/scenarios/` | scenario registry, runtime, manoeuvre evaluators, autopilot |
| `src/jurisdictions/` | one file per profile + `index.ts` registry |
| `src/theory/` | question banks + quiz engine |
| `src/signs/` | `signSvg(kind, style, opts): string` + catalogue |
| `src/render/` | three.js renderer, world/vehicle meshes, cameras, mirrors, environment |
| `src/input/` | `createInput(...)`: keyboard/gamepad/touch → `ControlInput` |
| `src/audio/` | `createAudio(...)`: engine, indicator tick, horn, chimes, speech |
| `src/ui/` | design system (CSS), DOM helper, screens, HUD |
| `src/app/` | app state machine, game loop, persistence |

## 6. Controls (default keyboard map — uses `KeyboardEvent.code`)

| Action | Keys |
|---|---|
| Accelerate / brake | `W` / `S` or `↑` / `↓` |
| Steer | `A` / `D` or `←` / `→` |
| Left / right indicator | `Q` / `E` |
| Hazard lights | `T` |
| Look left / behind / right (hold) | `Z` / `X` / `C` |
| Check left / centre / right mirror | `1` / `2` / `3` |
| Gears: Park / Reverse / Neutral / Drive | `P` / `R` / `N` / `F` |
| Parking brake | `Space` |
| Headlights / wipers | `L` / `K` |
| Seatbelt / engine start-stop | `B` / `I` |
| Horn | `H` |
| Change camera | `V` |
| Pause | `Esc` |

Looking over a shoulder for ≥ 0.25 s counts as a blind-spot check on that side
(and also refreshes that side's mirror). Looking behind counts as rear
observation for reversing.

## 7. Working agreements for contributors (human or AI)

* Run `npm run typecheck` and `npx vitest run <your test files>` before handing
  off. While several modules are being built in parallel the full type-check may
  show errors in files you do not own — only your own files must be clean.
* Do not run `git commit`, `git add`, `git stash`, `git checkout` or any other
  git command that changes the repository or index; the coordinator commits.
* Browser-side modules are checked with a harness page under `dev/` (for
  example `dev/ui-gallery.html` + `dev/ui-gallery.ts`). Vite's dev server serves
  them, they are type-checked, and they are not part of the production build.
  Headless Chromium with Playwright is available (`require('playwright')`,
  WebGL works) for screenshots; write throw-away scripts and screenshots to
  `.tmp/` (git-ignored).
* Keep modules small and documented where the logic is not obvious. Prefer
  plain functions and data over class hierarchies.
* Road-safety content must be correct. If you are not sure a rule is right for
  a jurisdiction, look it up in the official handbook and cite it, or leave it
  out. Never invent a legal fact.
