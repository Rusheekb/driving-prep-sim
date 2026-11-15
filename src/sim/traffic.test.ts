import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../core/constants';
import { obbOverlap } from '../core/math';
import type { JurisdictionProfile } from '../core/types';
import { GB } from '../jurisdictions/gb';
import { US_CA } from '../jurisdictions/us-ca';
import { DEFAULT_SESSION } from '../app/settings';
import { createSession } from './session';
import { vehicleObb } from './vehicle';

const PRIORITY_RIGHT: JurisdictionProfile = { ...US_CA, id: 'test-ptr', rules: { ...US_CA.rules, uncontrolledPriority: 'priority_to_right', allWayStops: false, pedestrianPriority: 'on_or_waiting' } };

function soak(profile: JurisdictionProfile, minutes: number, seed: number) {
  const session = createSession({ scenarioId: 'free-drive', profile, settings: { ...DEFAULT_SESSION, traffic: 'heavy', pedestrians: 'many', seed } });
  const ctx = session.ctx;
  const idle = { throttle: 0, brake: 0, steer: 0, look: 'ahead' as const, horn: false, commands: [] };
  const start = new Map(ctx.vehicles.map((v) => [v.id, { x: v.x, z: v.z, dist: 0 }]));
  let overlaps = 0;
  let redRuns = 0;
  let pedHits = 0;
  let maxOverSpeed = 0;
  let crossings = 0;
  const wasCrossing = new Set<number>();
  const steps = Math.round((minutes * 60) / SIM_DT);
  for (let i = 0; i < steps; i++) {
    const before = ctx.vehicles.map((v) => ({ id: v.id, lane: v.nav?.laneId ?? null }));
    session.tick(idle);
    for (const v of ctx.vehicles) {
      const rec = start.get(v.id);
      if (rec) {
        rec.dist += Math.hypot(v.x - rec.x, v.z - rec.z);
        rec.x = v.x;
        rec.z = v.z;
      }
      const nav = v.nav!;
      if (nav.laneId) {
        const lane = session.network.lanes.get(nav.laneId)!;
        maxOverSpeed = Math.max(maxOverSpeed, v.speed / lane.speedLimit);
      } else {
        // Just entered a junction this tick: must not have been on red.
        const was = before.find((b) => b.id === v.id);
        if (was && was.lane) {
          const lane = session.network.lanes.get(was.lane)!;
          if (lane.endControl === 'signal' && ctx.signals.getState(lane.to, lane.arrivalArm) === 'red') redRuns++;
        }
      }
    }
    for (const p of ctx.pedestrians) {
      if (p.state === 'crossing' && !wasCrossing.has(p.id)) {
        wasCrossing.add(p.id);
        crossings++;
      }
    }
    if (i % 6 === 0) {
      const boxes = ctx.vehicles.map((v) => vehicleObb(v, -0.05));
      for (let a = 0; a < boxes.length; a++) {
        for (let b = a + 1; b < boxes.length; b++) {
          if (Math.abs(boxes[a]!.x - boxes[b]!.x) < 7 && Math.abs(boxes[a]!.z - boxes[b]!.z) < 7 && obbOverlap(boxes[a]!, boxes[b]!)) overlaps++;
        }
        for (const p of ctx.pedestrians) {
          if (ctx.vehicles[a]!.speed > 0.5 && Math.abs(p.x - boxes[a]!.x) < 4 && Math.abs(p.z - boxes[a]!.z) < 4 && obbOverlap(boxes[a]!, { x: p.x, z: p.z, heading: 0, halfLength: 0.2, halfWidth: 0.2 })) pedHits++;
        }
      }
    }
  }
  const dists = [...start.values()].map((r) => r.dist);
  return { overlaps, redRuns, pedHits, maxOverSpeed, minDist: Math.min(...dists), meanDist: dists.reduce((a, b) => a + b, 0) / dists.length, crossings, count: ctx.vehicles.length };
}

describe('traffic soak', () => {
  it.each([
    ['keep right (California)', US_CA, 3],
    ['keep left (Great Britain)', GB, 5],
    ['priority to the right', PRIORITY_RIGHT, 9],
  ] as const)('%s: no collisions, no gridlock', (_name, profile, seed) => {
    const r = soak(profile, 8, seed);
    console.log(_name, JSON.stringify(r));
    expect(r.count).toBe(26);
    expect(r.overlaps).toBe(0);
    expect(r.pedHits).toBe(0);
    expect(r.redRuns).toBe(0);
    expect(r.maxOverSpeed).toBeLessThan(1.05);
    expect(r.minDist).toBeGreaterThan(250);
    expect(r.crossings).toBeGreaterThan(5);
  });

  it('is deterministic', () => {
    const a = soak(US_CA, 1, 4);
    const b = soak(US_CA, 1, 4);
    expect(a).toEqual(b);
  });
});
