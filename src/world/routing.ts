import type { RoadNetwork, RouteLeg, Turn, Vec2 } from '../core/types';

/** Nominal speed through a junction used for route costs, m/s. */
const JUNCTION_SPEED = 6;
/** Extra seconds charged per turn so routes prefer going straight when it is a wash. */
const TURN_PENALTY: Record<Turn, number> = { straight: 0, right: 2, left: 2, uturn: 20 };
/** Extra seconds for having to stop or give way at the end of a lane. */
const CONTROL_PENALTY = { signal: 8, stop: 6, yield: 3, none: 0 } as const;

export interface RouteOptions {
  /** Lanes the route must not use (other than the start and destination). */
  avoidLaneIds?: readonly string[];
}

/**
 * Quickest legal route from one lane to another (Dijkstra over lanes; the town
 * has ~100 lanes so a simple scan for the minimum is plenty).
 * The first leg is `fromLaneId`; the last leg is `toLaneId` with `connectorId: null`.
 */
export function findRoute(net: RoadNetwork, fromLaneId: string, toLaneId: string, opts: RouteOptions = {}): RouteLeg[] | null {
  if (!net.lanes.has(fromLaneId) || !net.lanes.has(toLaneId)) return null;
  if (fromLaneId === toLaneId) return [{ laneId: fromLaneId, connectorId: null }];
  const avoid = new Set(opts.avoidLaneIds ?? []);
  const cost = new Map<string, number>([[fromLaneId, 0]]);
  const via = new Map<string, { lane: string; connector: string }>();
  const done = new Set<string>();
  for (;;) {
    let current: string | null = null;
    let best = Infinity;
    for (const [id, c] of cost) {
      if (!done.has(id) && c < best) {
        best = c;
        current = id;
      }
    }
    if (current === null) return null;
    if (current === toLaneId) break;
    done.add(current);
    const lane = net.lanes.get(current)!;
    const base = best + lane.length / lane.speedLimit + CONTROL_PENALTY[lane.endControl];
    for (const cid of lane.connectors) {
      const c = net.connectors.get(cid)!;
      if (done.has(c.to) || (avoid.has(c.to) && c.to !== toLaneId)) continue;
      const next = base + c.length / JUNCTION_SPEED + TURN_PENALTY[c.turn];
      if (next < (cost.get(c.to) ?? Infinity)) {
        cost.set(c.to, next);
        via.set(c.to, { lane: current, connector: cid });
      }
    }
  }
  const legs: RouteLeg[] = [{ laneId: toLaneId, connectorId: null }];
  let at = toLaneId;
  while (at !== fromLaneId) {
    const step = via.get(at)!;
    legs.unshift({ laneId: step.lane, connectorId: step.connector });
    at = step.lane;
  }
  return legs;
}

/**
 * Build a route that passes through the given sequence of adjacent node ids
 * (e.g. ['B4', 'B3', 'C3']). Where a turn needs a different lane from the one
 * the previous turn delivered you into (multi-lane roads), the route contains
 * a LANE-CHANGE leg: a non-final leg with `connectorId: null` whose successor
 * is the neighbouring lane on the same road. Returns null if the nodes are not
 * connected.
 */
export function routeThroughNodes(net: RoadNetwork, nodeIds: readonly string[]): RouteLeg[] | null {
  if (nodeIds.length < 2) return null;
  const hops: string[][] = [];
  for (let i = 0; i + 1 < nodeIds.length; i++) {
    const ids = [...net.lanes.values()]
      .filter((l) => l.from === nodeIds[i] && l.to === nodeIds[i + 1])
      .sort((a, b) => b.index - a.index) // kerb-most first
      .map((l) => l.id);
    if (!ids.length) return null;
    hops.push(ids);
  }
  const legs: RouteLeg[] = [];
  let current = hops[0]![0]!;
  for (let i = 0; i + 1 < hops.length; i++) {
    const next = new Set(hops[i + 1]!);
    // Prefer staying in the current lane; otherwise the nearest lane that has the movement.
    const here = net.lanes.get(current)!;
    const candidates = [...hops[i]!].sort((a, b) => Math.abs(net.lanes.get(a)!.index - here.index) - Math.abs(net.lanes.get(b)!.index - here.index));
    let found: { lane: string; connector: string; to: string } | null = null;
    for (const laneId of candidates) {
      const conn = net.lanes.get(laneId)!.connectors.map((id) => net.connectors.get(id)!).find((c) => next.has(c.to));
      if (conn) {
        found = { lane: laneId, connector: conn.id, to: conn.to };
        break;
      }
    }
    if (!found) return null;
    if (found.lane !== current) legs.push({ laneId: current, connectorId: null });
    legs.push({ laneId: found.lane, connectorId: found.connector });
    current = found.to;
  }
  legs.push({ laneId: current, connectorId: null });
  return legs;
}

/** True when leg `i` is a lane change (the route continues in the neighbouring lane of the same road). */
export const isLaneChange = (legs: readonly RouteLeg[], i: number): boolean => i + 1 < legs.length && legs[i]!.connectorId === null;

/** Total driving distance of a route from `fromS` on the first lane to `toS` on the last (default: its end). */
export function routeLength(net: RoadNetwork, legs: readonly RouteLeg[], fromS = 0, toS?: number): number {
  let total = 0;
  legs.forEach((leg, i) => {
    if (isLaneChange(legs, i)) return; // counted with the neighbouring lane
    const lane = net.lanes.get(leg.laneId)!;
    const start = i === 0 ? fromS : 0;
    const end = i === legs.length - 1 && toS !== undefined ? toS : lane.length;
    total += Math.max(0, end - start);
    if (leg.connectorId) total += net.connectors.get(leg.connectorId)!.length;
  });
  return total;
}

/** Centre-line polyline of a route (lane centre lines + connector paths), for guidance lines and the minimap. */
export function routePolyline(net: RoadNetwork, legs: readonly RouteLeg[], fromS = 0, toS?: number, spacing = 4): Vec2[] {
  const out: Vec2[] = [];
  const push = (p: Vec2): void => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.05) out.push({ x: p.x, z: p.z });
  };
  let resume = fromS;
  legs.forEach((leg, i) => {
    const lane = net.lanes.get(leg.laneId)!;
    const start = Math.min(lane.length, resume);
    let end = i === legs.length - 1 && toS !== undefined ? Math.min(lane.length, toS) : lane.length;
    resume = 0;
    if (isLaneChange(legs, i)) {
      // Drift across to the next lane over ~25 m, a little way along.
      end = Math.min(lane.length - 30, Math.max(start + 12, start));
      resume = Math.min(lane.length, end + 25);
    }
    if (end > start) {
      const steps = Math.max(1, Math.ceil((end - start) / spacing));
      for (let k = 0; k <= steps; k++) push(net.lanePose(lane.id, start + ((end - start) * k) / steps));
    }
    if (leg.connectorId) for (const p of net.connectors.get(leg.connectorId)!.points) push(p);
  });
  return out;
}
