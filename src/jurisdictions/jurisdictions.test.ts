import { describe, expect, it } from 'vitest';
import { FAULTS } from '../rules/catalog';
import { describeFault } from '../rules/messages';
import type { FaultCode } from '../core/types';
import { signStyleFor, signSvg, signsFor } from '../signs';
import { buildRoadNetwork } from '../world/network';
import { TOWN } from '../world/town';
import { JURISDICTIONS, getJurisdiction, guessJurisdictionId } from './index';

const LEFT = new Set(['GB', 'IE', 'AU', 'NZ', 'IN', 'JP', 'ZA']);
const MANEUVERS = new Set(['parallel_park', 'reverse_bay_park', 'forward_bay_park', 'three_point_turn', 'reverse_straight', 'curbside_stop', 'emergency_stop']);

describe('jurisdiction registry', () => {
  it('has unique ids and a working default', () => {
    expect(JURISDICTIONS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(JURISDICTIONS.map((p) => p.id)).size).toBe(JURISDICTIONS.length);
    expect(getJurisdiction('nope').id).toBe('us-ca');
    expect(JURISDICTIONS.some((p) => p.id === guessJurisdictionId('en-GB'))).toBe(true);
  });
});

describe.each(JURISDICTIONS.map((p) => [p.id, p] as const))('profile %s', (_id, p) => {
  it('is internally consistent', () => {
    expect(p.drivingSide).toBe(LEFT.has(p.countryCode) ? 'left' : 'right');
    expect(p.speedUnit).toBe(p.countryCode === 'US' || p.countryCode === 'GB' ? 'mph' : 'km/h');
    const s = p.speedLimits;
    expect(s.lot).toBeGreaterThan(0);
    expect(s.lot).toBeLessThanOrEqual(s.school);
    expect(s.school).toBeLessThanOrEqual(s.residential);
    expect(s.residential).toBeLessThanOrEqual(s.urban);
    expect(s.urban).toBeLessThanOrEqual(s.arterial);
    expect(s.arterial).toBeLessThanOrEqual(p.speedUnit === 'mph' ? 50 : 80);
    const r = p.rules;
    expect(r.signalGuidanceDistanceM).toBeGreaterThanOrEqual(15);
    expect(r.signalGuidanceDistanceM).toBeLessThanOrEqual(100);
    if (r.signalMinDistanceM !== null) expect(r.signalGuidanceDistanceM).toBeCloseTo(r.signalMinDistanceM, 1);
    expect(r.followingGapS).toBeGreaterThanOrEqual(1.5);
    expect(r.followingGapS).toBeLessThanOrEqual(4);
    expect(r.signalMinTimeLaneChangeS).toBeGreaterThan(0);
    expect(p.facts.bacLimit).toBeGreaterThan(0);
    expect(p.facts.bacLimit).toBeLessThanOrEqual(0.08);
    expect(p.facts.bacLimitNovice).toBeLessThanOrEqual(p.facts.bacLimit);
    const sc = p.roadTest.scoring;
    expect(sc.maxPoints).toBeGreaterThan(0);
    expect(sc.pointsPerMinor).toBeGreaterThan(0);
    expect(p.roadTest.mockTestManeuvers.length).toBeGreaterThan(0);
    for (const m of p.roadTest.mockTestManeuvers) expect(MANEUVERS.has(m), m).toBe(true);
    expect(new Set(p.roadTest.mockTestManeuvers).size).toBe(p.roadTest.mockTestManeuvers.length);
    expect(p.knowledgeTest.passMark).toBeLessThanOrEqual(p.knowledgeTest.questionCount);
    expect(p.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.sources.length).toBeGreaterThanOrEqual(3);
    for (const src of p.sources) expect(src.url).toMatch(/^https:\/\//);
    expect(p.handbookUrl).toMatch(/^https:\/\//);
    for (const [k, v] of Object.entries(p.terms)) expect(v.length, k).toBeGreaterThan(0);
    for (const code of Object.keys(p.faultSeverityOverrides ?? {})) expect(code in FAULTS, code).toBe(true);
    expect(p.roadTest.overview.length).toBeGreaterThanOrEqual(3);
  });

  it('builds a town, signs and fault text', () => {
    const net = buildRoadNetwork(TOWN, p);
    expect(net.lanes.size).toBeGreaterThan(90);
    const style = signStyleFor(p);
    for (const kind of signsFor(style)) expect(signSvg(kind, style, { value: 30 })).toContain('<svg');
    for (const code of Object.keys(FAULTS) as FaultCode[]) {
      const t = describeFault(code, p, { speed: 30, limit: 25 });
      for (const text of [t.title, t.detail, t.tip]) {
        expect(text.length, code).toBeGreaterThan(3);
        expect(/undefined|NaN|\{|\}/.test(text), `${code}: ${text}`).toBe(false);
      }
    }
  });
});
