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
 * (e.g. ['B4', 'B3', 'C3']). Chooses lanes so that every turn starts from a lane
 * that actually has that movement. Returns null if the nodes are not connected.
 */
export function routeThroughNodes(net: RoadNetwork, nodeIds: readonly string[]): RouteLeg[] | null {
  if (nodeIds.length < 2) return null;
  // Candidate lanes for each hop.
  const hops: string[][] = [];
  for (let i = 0; i + 1 < nodeIds.length; i++) {
    const ids = [...net.lanes.values()].filter((l) => l.from === nodeIds[i] && l.to === nodeIds[i + 1]).map((l) => l.id);
    if (!ids.length) return null;
    hops.push(ids);
  }
  // Walk backwards so each lane choice is known to connect onward; prefer the kerb-most lane when free to choose.
  let nextChoices = new Map<string, RouteLeg[]>();
  for (const id of hops[hops.length - 1]!) nextChoices.set(id, [{ laneId: id, connectorId: null }]);
  for (let i = hops.length - 2; i >= 0; i--) {
    const choices = new Map<string, RouteLeg[]>();
    for (const id of hops[i]!) {
      const lane = net.lanes.get(id)!;
      let bestTail: RouteLeg[] | null = null;
      let bestConn: string | null = null;
      for (const cid of lane.connectors) {
        const c = net.connectors.get(cid)!;
        const tail = nextChoices.get(c.to);
        if (tail && (!bestTail || net.lanes.get(c.to)!.index > net.lanes.get(bestTail[0]!.laneId)!.index)) {
          bestTail = tail;
          bestConn = cid;
        }
      }
      if (bestTail && bestConn) choices.set(id, [{ laneId: id, connectorId: bestConn }, ...bestTail]);
    }
    if (!choices.size) return null;
    nextChoices = choices;
  }
  let best: RouteLeg[] | null = null;
  for (const legs of nextChoices.values()) {
    if (!best || net.lanes.get(legs[0]!.laneId)!.index > net.lanes.get(best[0]!.laneId)!.index) best = legs;
  }
  return best;
}

/** Total driving distance of a route from `fromS` on the first lane to `toS` on the last (default: its end). */
export function routeLength(net: RoadNetwork, legs: readonly RouteLeg[], fromS = 0, toS?: number): number {
  let total = 0;
  legs.forEach((leg, i) => {
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
  legs.forEach((leg, i) => {
    const lane = net.lanes.get(leg.laneId)!;
    const start = Math.min(lane.length, i === 0 ? fromS : 0);
    const end = i === legs.length - 1 && toS !== undefined ? Math.min(lane.length, toS) : lane.length;
    if (end > start) {
      const steps = Math.max(1, Math.ceil((end - start) / spacing));
      for (let k = 0; k <= steps; k++) push(net.lanePose(lane.id, start + ((end - start) * k) / steps));
    }
    if (leg.connectorId) for (const p of net.connectors.get(leg.connectorId)!.points) push(p);
  });
  return out;
}
