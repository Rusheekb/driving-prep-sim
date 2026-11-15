/**
 * Pedestrians who use the town's crossings so the learner can practise giving
 * way: they walk up, wait at the kerb, cross when it is safe (or when the
 * signal says walk) and walk on.
 */
import type { CrosswalkInfo, SimContext, SimPedestrian, Vec2 } from '../core/types';
import type { BuiltNetwork } from '../world/network';
import { vehicleObb } from './vehicle';
import { obbContainsPoint } from '../core/math';

export interface PedestrianOptions {
  /** Average seconds between crossing events (default from ctx.settings.pedestrians). */
  interval?: number;
  /** Most pedestrians alive at once. */
  max?: number;
}

export interface PedestrianSystem {
  update(ctx: SimContext, dt: number): void;
  /** Scripted crossing: appears beside the crosswalk, waits `delay` s at the kerb, then crosses when allowed. */
  spawnCrossing(ctx: SimContext, crosswalkId: string, opts?: { delay?: number; fromEnd?: 'a' | 'b'; assertive?: boolean }): SimPedestrian;
}

interface Walker {
  ped: SimPedestrian;
  xw: CrosswalkInfo;
  from: Vec2;
  to: Vec2;
  /** Where they stand while waiting (just behind the kerb). */
  kerb: Vec2;
  exit: Vec2;
  phase: 'approach' | 'wait' | 'cross' | 'leave';
  waited: number;
  minWait: number;
  assertive: boolean;
  speed: number;
}

const INTERVAL = { none: Infinity, few: 26, many: 9 } as const;
const MAX = { none: 0, few: 4, many: 10 } as const;

export function createPedestrians(ctx: SimContext, opts: PedestrianOptions = {}): PedestrianSystem {
  const net = ctx.network as BuiltNetwork;
  const rng = ctx.rng.fork();
  const walkers: Walker[] = [];
  let nextId = 5000;
  const interval = opts.interval ?? INTERVAL[ctx.settings.pedestrians];
  const max = opts.max ?? MAX[ctx.settings.pedestrians];
  let timer = isFinite(interval) ? rng.range(3, 8) : Infinity;
  const crosswalks = [...net.crosswalks.values()];

  function make(xw: CrosswalkInfo, fromEnd: 'a' | 'b', delay: number, assertive: boolean): Walker {
    const from = fromEnd === 'a' ? xw.a : xw.b;
    const to = fromEnd === 'a' ? xw.b : xw.a;
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    const ux = (to.x - from.x) / len;
    const uz = (to.z - from.z) / len;
    const kerb = { x: from.x - ux * 0.7, z: from.z - uz * 0.7 };
    const start = { x: from.x - ux * 3.2, z: from.z - uz * 3.2 };
    const exit = { x: to.x + ux * 3.4, z: to.z + uz * 3.4 };
    const ped: SimPedestrian = { id: nextId++, x: start.x, z: start.z, heading: Math.atan2(ux, uz), speed: 0, state: 'walking', crosswalkId: null, look: rng.int(0, 4095) };
    const w: Walker = { ped, xw, from, to, kerb, exit, phase: 'approach', waited: 0, minWait: delay, assertive, speed: rng.range(1.25, 1.55) };
    walkers.push(w);
    ctx.pedestrians.push(ped);
    return w;
  }

  /** Distance (m) a vehicle on the network still has to travel to reach the crossing, or null if it is not heading for it. */
  function distanceToCrossing(xw: CrosswalkInfo, laneId: string | null, connectorId: string | null, s: number): number | null {
    if (laneId) {
      const lane = net.lanes.get(laneId)!;
      if (lane.midblock && lane.midblock.crosswalkId === xw.id) return s < lane.midblock.endS ? lane.midblock.stopS - s : null;
      if (xw.nodeId !== lane.to) return null;
      let best: number | null = null;
      for (const cid of lane.connectors) {
        const c = net.connectors.get(cid)!;
        const hit = c.crosswalks.find((k) => k.id === xw.id);
        if (hit) best = Math.min(best ?? Infinity, lane.length - s + hit.s);
      }
      return best;
    }
    if (connectorId) {
      const c = net.connectors.get(connectorId)!;
      const hit = c.crosswalks.find((k) => k.id === xw.id);
      return hit && hit.s > s - 2 ? hit.s - s : null;
    }
    return null;
  }

  /** Is it safe to step out: every approaching vehicle is stopped or far enough to stop comfortably. */
  function safeToCross(c: SimContext, xw: CrosswalkInfo): boolean {
    const check = (d: number | null, speed: number): boolean => d === null || speed < 0.5 || d > (speed * speed) / (2 * 2.5) + 7;
    for (const v of c.vehicles) {
      if (!v.nav) continue;
      if (!check(distanceToCrossing(xw, v.nav.laneId, v.nav.connectorId, v.nav.s), v.speed)) return false;
    }
    const p = c.player;
    const loc = p.location;
    const speed = Math.abs(p.vehicle.speed);
    if (loc.kind === 'lane' && Math.cos(p.vehicle.heading - loc.lane.heading) > 0.2) {
      if (!check(distanceToCrossing(xw, loc.lane.id, null, loc.s), speed)) return false;
    } else if (loc.kind === 'junction' && loc.connector) {
      if (!check(distanceToCrossing(xw, null, loc.connector.id, loc.s), speed)) return false;
    }
    return true;
  }

  /** Is a vehicle footprint right where the pedestrian is about to step? */
  function blocked(c: SimContext, x: number, z: number): boolean {
    const pt = { x, z };
    if (obbContainsPoint(vehicleObb(c.player.vehicle, 1.2), pt)) return true;
    for (const v of c.vehicles) {
      if (Math.abs(v.x - x) > 8 || Math.abs(v.z - z) > 8) continue;
      if (obbContainsPoint(vehicleObb(v, 1.2), pt)) return true;
    }
    return false;
  }

  function moveToward(w: Walker, target: Vec2, dt: number, c: SimContext, guard: boolean): boolean {
    const p = w.ped;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      p.speed = 0;
      return true;
    }
    const stepLen = Math.min(d, w.speed * dt);
    const nx = p.x + (dx / d) * stepLen;
    const nz = p.z + (dz / d) * stepLen;
    p.heading = Math.atan2(dx, dz);
    if (guard && blocked(c, p.x + (dx / d) * 1.4, p.z + (dz / d) * 1.4)) {
      p.speed = 0;
      return false;
    }
    p.x = nx;
    p.z = nz;
    p.speed = w.speed;
    return stepLen >= d - 1e-6;
  }

  return {
    update(c, dt) {
      timer -= dt;
      if (timer <= 0 && walkers.length < max && crosswalks.length) {
        timer = interval * rng.range(0.6, 1.4);
        const pl = c.player.vehicle;
        // Prefer crossings the learner will actually meet, but never right in front of them.
        const pool = crosswalks.filter((x) => {
          const d = Math.hypot((x.a.x + x.b.x) / 2 - pl.x, (x.a.z + x.b.z) / 2 - pl.z);
          return d > 38 && d < 190 && !walkers.some((w) => w.xw.id === x.id);
        });
        const pick = pool.length ? rng.pick(pool) : null;
        if (pick) make(pick, rng.chance(0.5) ? 'a' : 'b', rng.range(1, 2.5), !pick.signalised && rng.chance(0.55));
      }

      for (let i = walkers.length - 1; i >= 0; i--) {
        const w = walkers[i]!;
        const p = w.ped;
        if (w.phase === 'approach') {
          if (moveToward(w, w.kerb, dt, c, false)) {
            w.phase = 'wait';
            p.state = 'waiting';
            p.crosswalkId = w.xw.id;
            p.heading = Math.atan2(w.to.x - w.from.x, w.to.z - w.from.z);
          }
        } else if (w.phase === 'wait') {
          p.speed = 0;
          w.waited += dt;
          if (w.waited < w.minWait) continue;
          const go = w.xw.signalised ? c.signals.getWalkState(w.xw.id) === 'walk' && safeToCross(c, w.xw) : safeToCross(c, w.xw);
          // Unassertive pedestrians hang back a little longer for a bigger gap.
          if (go && (w.assertive || w.xw.signalised || w.waited > w.minWait + 2.5)) {
            w.phase = 'cross';
            p.state = 'crossing';
          }
        } else if (w.phase === 'cross') {
          if (moveToward(w, w.to, dt, c, true)) {
            w.phase = 'leave';
            p.state = 'walking';
            p.crosswalkId = null;
          }
        } else if (moveToward(w, w.exit, dt, c, false)) {
          walkers.splice(i, 1);
          const k = c.pedestrians.indexOf(p);
          if (k >= 0) c.pedestrians.splice(k, 1);
        }
      }
    },
    spawnCrossing(c, crosswalkId, o = {}) {
      void c;
      const xw = net.crosswalks.get(crosswalkId);
      if (!xw) throw new Error(`Unknown crosswalk ${crosswalkId}`);
      return make(xw, o.fromEnd ?? 'a', o.delay ?? 1, o.assertive ?? true).ped;
    },
  };
}
