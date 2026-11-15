import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION } from '../app/settings';
import { SIM_DT } from '../core/constants';
import type { JurisdictionProfile } from '../core/types';
import { GB } from '../jurisdictions/gb';
import { US_CA } from '../jurisdictions/us-ca';
import { createSession } from '../sim/session';
import { createAutopilot } from './autopilot';
import { getScenario } from './defs';

mkdirSync('.tmp', { recursive: true });
writeFileSync('.tmp/auto.txt', '');
const log = (line: string): void => appendFileSync('.tmp/auto.txt', line + '\n');

function run(id: string, profile: JurisdictionProfile, minutes: number, seed = 11) {
  const def = getScenario(id)!;
  const session = createSession({ scenarioId: id, profile, settings: { ...DEFAULT_SESSION, ...def.meta.defaults, observation: 'strict', feedback: 'coach', seed } });
  const pilot = createAutopilot(session);
  const steps = Math.round((minutes * 60) / SIM_DT);
  let i = 0;
  for (; i < steps && !session.ended; i++) session.tick(pilot.input());
  const r = session.result(0);
  const counts = new Map<string, number>();
  for (const f of r.faults) counts.set(f.code, (counts.get(f.code) ?? 0) + 1);
  log(`${id} [${profile.id}] ${session.scenario.status} step ${session.scenario.step}/${session.scenario.totalSteps} t=${session.ctx.time.toFixed(0)}s first=${r.faults[0] ? `${r.faults[0].code}@${r.faults[0].time.toFixed(0)}` : '-'} ${[...counts].map(([c, n]) => `${c}x${n}`).join(' ')}`);
  return { session, result: r };
}

const DRIVES = ['lesson-moving-off', 'lesson-junctions', 'lesson-stops', 'lesson-lights', 'lesson-roundabouts', 'lesson-crossings', 'lesson-night-rain', 'skill-kerbside-stop', 'skill-emergency-stop'];

describe('a textbook drive earns no faults', () => {
  for (const profile of [US_CA, GB]) {
    it.each(DRIVES)(`%s (${profile.id})`, (id) => {
      const { session, result } = run(id, profile, 9);
      expect(session.scenario.status).toBe('completed');
      expect(result.faults.map((f) => f.code)).toEqual([]);
    });
  }
});

describe('mock test', () => {
  it.each([US_CA, GB])('drives fault-free up to the first manoeuvre ($id)', (profile) => {
    const def = getScenario('test-full')!;
    const session = createSession({ scenarioId: 'test-full', profile, settings: { ...DEFAULT_SESSION, ...def.meta.defaults, seed: 5 } });
    const pilot = createAutopilot(session);
    const hard = new Set(['reverse_straight', 'parallel_park', 'three_point_turn', 'reverse_bay_park', 'forward_bay_park']);
    for (let i = 0; i < 60 * 60 * 9 && !session.ended && !hard.has(session.scenario.activeManeuver ?? ''); i++) session.tick(pilot.input());
    log(`test-full [${profile.id}] step ${session.scenario.step}/${session.scenario.totalSteps} t=${session.ctx.time.toFixed(0)}s manoeuvre=${session.scenario.activeManeuver} faults=${session.faults.map((f) => `${f.code}@${f.time.toFixed(0)}`).join(',')}`);
    expect(session.scenario.step).toBeGreaterThanOrEqual(2);
    expect(session.faults.map((f) => f.code)).toEqual([]);
  });
});
