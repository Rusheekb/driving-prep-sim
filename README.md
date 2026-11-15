# Learner Lane — driving test simulator

**Learn it here. Pass it out there.**

Learner Lane is a free, browser-based driving simulator that helps learner
drivers prepare for their driving test. You drive a small 3D town with traffic
lights, stop signs, roundabouts, a school zone, pedestrians and other traffic,
while a built-in examiner watches your observation, signalling, speed,
positioning and right-of-way decisions — and explains every fault, kindly.

**Play it:** https://rusheekb.github.io/driving-prep-sim/

No account, no ads, no downloads. Works with keyboard, touch (phones and
tablets) and gamepads. Everything is generated in code, so it works offline
once loaded.

## What you can practise

| | |
|---|---|
| **Lessons** | Nine guided lessons with an instructor talking you through each step: the cockpit drill, moving off and pulling over, junctions, stop signs and priority, traffic lights, roundabouts, lane changes, pedestrian crossings, night and rain. Most can be watched first as an **instructor demo**. |
| **Skill drills** | Parallel parking, reverse and forward bay parking, turn in the road, reversing in a straight line, emergency stop, kerbside stop. |
| **Mock road test** | An examiner gives directions around a full route with the manoeuvres your region's test includes, marked with your region's scheme (fault counts or points, automatic fails). |
| **Free drive** | Explore in any weather, time of day and traffic level. |
| **Theory test** | Practice questions, a full-length mock with the real pass mark, sign recognition and "review my mistakes". |
| **Road signs & local rules** | A sign library drawn in your country's style and a plain-language summary of the rules, the road test and the knowledge test, with links to the official sources. |
| **Drive review** | After every drive: each fault on a map of your route, what happened, and how to fix it. Progress, stars and a test-readiness meter are kept in your browser. |

## Different places, different rules

Pick your region and the simulator changes with it:

* side of the road, speed units and typical posted limits
* road-sign designs, line colours, crossing markings and traffic-light sequence
* priority rules (all-way stops, give-way junctions, priority to the right…)
* turning on red, signalling distances, following gaps, pedestrian priority
* vocabulary (indicator / turn signal, kerb / curb, give way / yield…)
* which manoeuvres the mock test includes and how it is marked

Each region is one data file in [`src/jurisdictions/`](src/jurisdictions) with
its official sources listed. Adding a region is adding a file — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> **Practice aid only.** Learner Lane is not affiliated with any licensing
> authority and is no substitute for a qualified instructor or the official
> handbook. Laws change; if anything here differs from your official handbook,
> the handbook is right. Never use it while driving.

## Controls (keyboard)

| Action | Keys |
|---|---|
| Accelerate / brake / steer | `W` `S` `A` `D` or arrow keys |
| Indicators / hazards | `Q` `E` / `T` |
| Check mirrors (left, centre, right) | `1` `2` `3` |
| Look over shoulder / behind (hold) | `Z` `C` / `X` |
| Gears: Park, Reverse, Neutral, Drive | `P` `R` `N` `F` |
| Parking brake | `Space` |
| Seatbelt / engine / headlights / wipers / horn | `B` `I` `L` `K` `H` |
| Camera / pause | `V` / `Esc` |

Touch controls appear automatically on phones and tablets; the in-app
**Controls** screen covers touch and gamepad layouts.

## Development

```bash
npm install
npm run dev        # local dev server
npm run check      # type-check, unit tests and production build
```

The simulation core (road network, traffic, rules, scenarios) is headless
TypeScript covered by unit tests — including an "instructor autopilot" that
must be able to drive every lesson on both sides of the road without the
examiner recording a single fault. The 3D view is three.js.

## Deployment

Pushing to the default branch runs `.github/workflows/deploy.yml`, which
type-checks, tests, builds and publishes `dist/` to GitHub Pages. Pages must be
enabled once for the repository: **Settings → Pages → Source: GitHub Actions**.

## Licence

MIT — see [LICENSE](LICENSE).
