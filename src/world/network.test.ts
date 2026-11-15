import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { angleDiff, dist, headingOf, rightOf } from '../core/math';
import type { ConnectorInfo, LaneInfo } from '../core/types';
import { nodeOutline } from './layout';
import { type BuiltNetwork, buildRoadNetwork, validateMap } from './network';
import { findRoute, routeLength, routePolyline, routeThroughNodes } from './routing';
import { createSignalSystem } from './signals';
import { TEST_LEFT, TEST_RIGHT } from './testProfiles';
import { TOWN } from './town';

const right = buildRoadNetwork(TOWN, TEST_RIGHT);
const left = buildRoadNetwork(TOWN, TEST_LEFT);
const both: [string, BuiltNetwork][] = [
  ['right', right],
  ['left', left],
];

describe('town map', () => {
  it('is valid', () => {
    expect(validateMap(TOWN)).toEqual([]);
    expect(TOWN.nodes).toHaveLength(30);
    expect(TOWN.roads).toHaveLength(49);
  });
});

describe.each(both)('network (keep %s)', (name, net) => {
  const kerb = name === 'right' ? 1 : -1;

  it('puts lanes on the correct side of the road axis', () => {
    for (const lane of net.lanes.values()) {
      const road = net.roads.get(lane.roadId)!;
      const r = rightOf(lane.heading);
      // Offset of the lane start from the road axis, measured to the right of travel.
      const from = net.nodes.get(lane.from)!.pos;
      const off = (lane.start.x - from.x) * r.x + (lane.start.z - from.z) * r.z;
      expect(Math.sign(off)).toBe(kerb);
      expect(Math.abs(off)).toBeLessThan(road.carriagewayWidth / 2);
    }
  });

  it('gives every lane at least one connector with continuous geometry', () => {
    for (const lane of net.lanes.values()) {
      expect(lane.connectors.length, lane.id).toBeGreaterThan(0);
      expect(lane.incoming.length, lane.id).toBeGreaterThan(0);
      expect(lane.length).toBeGreaterThan(20);
    }
    for (const c of net.connectors.values()) {
      const from = net.lanes.get(c.from)!;
      const to = net.lanes.get(c.to)!;
      expect(dist(c.points[0]!, from.end), c.id).toBeLessThan(0.05);
      expect(dist(c.points[c.points.length - 1]!, to.start), c.id).toBeLessThan(0.05);
      const h0 = headingOf(c.points[1]!.x - c.points[0]!.x, c.points[1]!.z - c.points[0]!.z);
      const n = c.points.length;
      const h1 = headingOf(c.points[n - 1]!.x - c.points[n - 2]!.x, c.points[n - 1]!.z - c.points[n - 2]!.z);
      expect(Math.abs(angleDiff(h0, from.heading)), c.id).toBeLessThan(0.2);
      expect(Math.abs(angleDiff(h1, to.heading)), c.id).toBeLessThan(0.2);
      for (let i = 2; i < n; i++) {
        const a = headingOf(c.points[i - 1]!.x - c.points[i - 2]!.x, c.points[i - 1]!.z - c.points[i - 2]!.z);
        const b = headingOf(c.points[i]!.x - c.points[i - 1]!.x, c.points[i]!.z - c.points[i - 1]!.z);
        expect(Math.abs(angleDiff(a, b)), `${c.id} kink at ${i}`).toBeLessThan(0.45);
      }
      expect(c.turn).not.toBe('uturn');
    }
  });

  it('classifies turns and crossing-oncoming movements', () => {
    for (const c of net.connectors.values()) {
      const node = net.nodes.get(c.nodeId)!;
      if (node.roundabout) {
        expect(c.exitNumber).toBeGreaterThan(0);
        continue;
      }
      const from = net.lanes.get(c.from)!;
      const to = net.lanes.get(c.to)!;
      const d = angleDiff(to.heading, from.heading);
      // Turning right decreases heading.
      const expected = Math.abs(d) < 0.1 ? 'straight' : d < 0 ? 'right' : 'left';
      expect(c.turn, c.id).toBe(expected);
      const across = name === 'right' ? 'left' : 'right';
      expect(c.crossesOncoming, c.id).toBe(c.turn === across);
    }
  });

  it('circulates roundabouts the correct way', () => {
    for (const node of net.nodes.values()) {
      if (!node.roundabout) continue;
      for (const id of node.connectorIds) {
        const c = net.connectors.get(id)!;
        // Signed area swept around the centre: anticlockwise seen from above (keep right) means
        // heading-angle of the radius vector increases.
        let sweep = 0;
        for (let i = 1; i < c.points.length; i++) {
          const a = headingOf(c.points[i - 1]!.x - node.pos.x, c.points[i - 1]!.z - node.pos.z);
          const b = headingOf(c.points[i]!.x - node.pos.x, c.points[i]!.z - node.pos.z);
          sweep += angleDiff(b, a);
        }
        expect(Math.sign(sweep), id).toBe(kerb);
      }
    }
  });

  it('records symmetric conflicts', () => {
    for (const c of net.connectors.values()) {
      for (const k of c.conflicts) {
        const other = net.connectors.get(k.other)!;
        const back = other.conflicts.find((o) => o.other === c.id);
        expect(back, `${c.id} vs ${k.other}`).toBeDefined();
        expect(back!.s).toBeCloseTo(k.otherS, 5);
      }
    }
    // Opposing straights on Main Street at B3 never conflict; a turn across oncoming does.
    const b3 = net.nodes.get('B3')!;
    const conns = b3.connectorIds.map((id) => net.connectors.get(id)!);
    const straightE = conns.find((c) => c.turn === 'straight' && net.lanes.get(c.from)!.travel === 'E')!;
    const straightW = conns.find((c) => c.turn === 'straight' && net.lanes.get(c.from)!.travel === 'W')!;
    expect(straightE.conflicts.some((k) => k.other === straightW.id)).toBe(false);
    const across = conns.find((c) => c.crossesOncoming && net.lanes.get(c.from)!.travel === 'E')!;
    expect(across.conflicts.some((k) => net.lanes.get(net.connectors.get(k.other)!.from)!.travel === 'W')).toBe(true);
  });

  it('round-trips lanePose through locate', () => {
    for (const lane of net.lanes.values()) {
      for (const f of [0.02, 0.5, 0.98]) {
        for (const lat of [-1.2, 0, 1.2]) {
          const p = net.lanePose(lane.id, lane.length * f, lat);
          const loc = net.locate(p);
          expect(loc.kind, `${lane.id} ${f} ${lat}`).toBe('lane');
          if (loc.kind !== 'lane') continue;
          expect(loc.lane.id).toBe(lane.id);
          expect(loc.s).toBeCloseTo(lane.length * f, 3);
          expect(loc.lateral).toBeCloseTo(lat, 3);
        }
      }
    }
  });

  it('classifies other surfaces', () => {
    expect(net.locate({ x: 55, z: 0 }).kind).toBe('junction'); // D3
    expect(net.locate({ x: 165, z: -110 }).kind).toBe('offroad'); // roundabout island E2
    expect(net.locate({ x: 165 + 9.5, z: -110 }).kind).toBe('junction'); // on the ring
    expect(net.locate({ x: 110, z: 175 })).toMatchObject({ kind: 'zone', onDriveway: false });
    expect(net.locate({ x: 110, z: 130 })).toMatchObject({ kind: 'zone', onDriveway: true });
    expect(net.locate({ x: 110, z: 114.5 })).toMatchObject({ kind: 'zone', onDriveway: true }); // driveway beats sidewalk
    expect(net.locate({ x: 100, z: 114.5 }).kind).toBe('sidewalk');
    expect(net.locate({ x: 0, z: -55 }).kind).toBe('offroad'); // block interior
    // Parking strip on Orchard Lane A4–B4 (z = 110), mid-block.
    const strip = net.locate({ x: -220, z: 110 + 3.4 + 1.2 });
    expect(strip.kind).toBe('parking_strip');
    if (strip.kind === 'parking_strip') expect(Math.abs(strip.lateral)).toBeGreaterThan(1.7);
    for (const c of net.connectors.values()) {
      const mid = c.points[Math.floor(c.points.length / 2)]!;
      const loc = net.locate(mid);
      expect(loc.kind, c.id).toBe('junction');
    }
  });

  it('routes across town', () => {
    const lanes = [...net.lanes.values()];
    const start = lanes.find((l) => l.from === 'A1' && l.to === 'B1')!;
    const goal = lanes.find((l) => l.from === 'E5' && l.to === 'F5')!;
    const legs = findRoute(net, start.id, goal.id)!;
    expect(legs.length).toBeGreaterThan(5);
    for (let i = 0; i + 1 < legs.length; i++) {
      const c = net.connectors.get(legs[i]!.connectorId!)!;
      expect(c.from).toBe(legs[i]!.laneId);
      expect(c.to).toBe(legs[i + 1]!.laneId);
    }
    expect(routeLength(net, legs)).toBeGreaterThan(500);
    const line = routePolyline(net, legs);
    for (let i = 1; i < line.length; i++) expect(dist(line[i]!, line[i - 1]!)).toBeLessThan(6);
    const via = routeThroughNodes(net, ['B4', 'B3', 'C3', 'C4', 'B4'])!;
    expect(via.map((l) => net.lanes.get(l.laneId)!.to)).toEqual(['B3', 'C3', 'C4', 'B4']);
  });

  it('writes a debug SVG', () => {
    mkdirSync('.tmp', { recursive: true });
    writeFileSync(`.tmp/network-${name}.svg`, debugSvg(net));
  });
});

describe('jurisdiction mapping', () => {
  it('downgrades all-way stops where they are not used', () => {
    expect(right.nodes.get('B2')!.control).toBe('allway_stop');
    expect(left.nodes.get('B2')!.control).toBe('yield_minor');
    const minor = [...left.lanes.values()].find((l) => l.to === 'B2' && (l.travel === 'N' || l.travel === 'S'))!;
    const major = [...left.lanes.values()].find((l) => l.to === 'B2' && (l.travel === 'E' || l.travel === 'W'))!;
    expect(minor.endControl).toBe('yield');
    expect(major.endControl).toBe('none');
    expect(right.crosswalks.has('xw:B2:N')).toBe(true);
    expect(left.crosswalks.has('xw:B2:N')).toBe(false);
  });
  it('converts speed limits', () => {
    const lane = [...right.lanes.values()].find((l) => l.speedClass === 'school')!;
    expect(lane.speedLimit).toBeCloseTo(20 * 0.44704, 5);
    expect(lane.midblock).not.toBeNull();
  });
});

describe('signals', () => {
  it.each([
    ['plain', TEST_RIGHT, right],
    ['red+amber', TEST_LEFT, left],
  ] as const)('never conflict (%s)', (_n, profile, net) => {
    const sig = createSignalSystem(net, profile);
    const seen = new Set<string>();
    let prev = sig.getState('D3', 'N');
    const order: string[] = [prev];
    for (let i = 0; i < 60 * 80; i++) {
      sig.update(1 / 60);
      for (const id of ['A3', 'B3', 'D3', 'E3', 'F3']) {
        const ns = sig.getState(id, 'N');
        const ew = sig.getState(id, 'E');
        const go = (c: string): boolean => c === 'green' || c === 'amber';
        expect(go(ns) && go(ew)).toBe(false);
        if (go(ns)) expect(sig.getWalkState(`xw:${id}:E`) === 'dont_walk' || ew === 'red' || ew === 'red_amber').toBe(true);
        // Walk across the N arm only while N/S traffic is held.
        if (sig.getWalkState(`xw:${id}:N`) !== 'dont_walk') expect(ns === 'red' || ns === 'red_amber').toBe(true);
        seen.add(ns);
      }
      const now = sig.getState('D3', 'N');
      if (now !== prev) order.push(now);
      prev = now;
    }
    expect(seen.has('red_amber')).toBe(profile.rules.trafficLightSequence === 'red_redamber_green_amber');
    const cycle = profile.rules.trafficLightSequence === 'red_redamber_green_amber' ? ['green', 'amber', 'red', 'red_amber'] : ['green', 'amber', 'red'];
    const start = order.indexOf('green');
    for (let i = start; i < order.length; i++) expect(order[i]).toBe(cycle[(i - start) % cycle.length]);
    expect(sig.getState('C3', 'N')).toBe('green');
  });
});

/* ------------------------------ debug drawing ------------------------------ */

function debugSvg(net: BuiltNetwork): string {
  const b = net.bounds;
  const out: string[] = [];
  const path = (pts: { x: number; z: number }[], close = false): string =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.z.toFixed(2)}`).join('') + (close ? 'Z' : '');
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - 5} ${b.minZ - 5} ${b.maxX - b.minX + 10} ${b.maxZ - b.minZ + 10}" style="background:#4b7a44">`,
  );
  for (const blk of net.blocks) {
    out.push(`<rect x="${blk.rect.minX}" y="${blk.rect.minZ}" width="${blk.rect.maxX - blk.rect.minX}" height="${blk.rect.maxZ - blk.rect.minZ}" fill="#b9b4a8"/>`);
    out.push(`<rect x="${blk.inner.minX}" y="${blk.inner.minZ}" width="${blk.inner.maxX - blk.inner.minX}" height="${blk.inner.maxZ - blk.inner.minZ}" fill="#6f9a5f"/>`);
  }
  for (const road of net.roads.values()) {
    const g = net.layout.roads.get(road.id)!;
    const horizontal = road.axis === 'EW';
    const x0 = Math.min(road.start.x, road.end.x);
    const z0 = Math.min(road.start.z, road.end.z);
    const rect = (half: number, fill: string, from = 0, to = g.length): string =>
      horizontal
        ? `<rect x="${x0 + from}" y="${z0 - half}" width="${to - from}" height="${half * 2}" fill="${fill}"/>`
        : `<rect x="${x0 - half}" y="${z0 + from}" width="${half * 2}" height="${to - from}" fill="${fill}"/>`;
    if (g.strip) out.push(rect(g.kerbOffset, '#555c66', g.strip.from, g.strip.to));
    out.push(rect(g.half, '#3a3f47'));
  }
  for (const node of net.layout.nodes.values()) {
    out.push(`<path d="${path(nodeOutline(node), true)}" fill="#3a3f47"/>`);
    if (node.roundabout) out.push(`<circle cx="${node.def.x}" cy="${node.def.z}" r="${node.roundabout.island}" fill="#6f9a5f"/>`);
  }
  for (const z of net.zones.values()) {
    out.push(`<rect x="${z.rect.minX}" y="${z.rect.minZ}" width="${z.rect.maxX - z.rect.minX}" height="${z.rect.maxZ - z.rect.minZ}" fill="#4a5059"/>`);
    out.push(`<rect x="${z.driveway.minX}" y="${z.driveway.minZ}" width="${z.driveway.maxX - z.driveway.minX}" height="${z.driveway.maxZ - z.driveway.minZ}" fill="#4a5059"/>`);
    for (const bay of z.bays) {
      out.push(
        `<rect x="${-bay.width / 2}" y="${-bay.length / 2}" width="${bay.width}" height="${bay.length}" fill="none" stroke="#fff" stroke-width="0.12" transform="translate(${bay.pose.x} ${bay.pose.z}) rotate(${(-bay.pose.heading * 180) / Math.PI})"/>`,
      );
    }
  }
  for (const xw of net.crosswalks.values()) {
    out.push(`<path d="${path([xw.a, xw.b])}" stroke="#fff" stroke-width="${xw.width}" stroke-dasharray="0.6 0.6" opacity="0.8"/>`);
  }
  const arrow = (lane: LaneInfo): string => {
    const m = net.lanePose(lane.id, lane.length / 2);
    return `<path d="M0 -1.6 L1 1 L0 0.4 L-1 1Z" fill="#ffd23f" transform="translate(${m.x} ${m.z}) rotate(${180 - (m.heading * 180) / Math.PI})"/>`;
  };
  for (const lane of net.lanes.values()) {
    out.push(`<path d="${path([lane.start, lane.end])}" stroke="#8fd3ff" stroke-width="0.25" opacity="0.7"/>`);
    out.push(arrow(lane));
  }
  const colour = (c: ConnectorInfo): string => (c.turn === 'straight' ? '#9be29b' : c.turn === 'left' ? '#ff9d5c' : '#d58cff');
  for (const c of net.connectors.values()) out.push(`<path d="${path(c.points)}" fill="none" stroke="${colour(c)}" stroke-width="0.22"/>`);
  for (const node of net.nodes.values()) {
    for (const arm of Object.values(node.arms)) {
      if (arm.stopLine) out.push(`<path d="${path([arm.stopLine.a, arm.stopLine.b])}" stroke="#ff4d4d" stroke-width="0.45"/>`);
    }
    out.push(`<text x="${node.pos.x}" y="${node.pos.z + 1}" font-size="3" text-anchor="middle" fill="#fff" font-family="sans-serif">${node.id}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}
