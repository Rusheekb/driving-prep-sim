import type { Fault, FaultCategory, FaultCode, JurisdictionProfile, ScoreSummary, Severity } from '../core/types';
import { FAULTS } from './catalog';

const RANK: Record<Severity, number> = { minor: 0, serious: 1, dangerous: 2 };

/** Severity after jurisdiction overrides. An explicit escalation (e.g. to dangerous) is never downgraded. */
export function effectiveSeverity(code: FaultCode, profile: JurisdictionProfile, proposed?: Severity): Severity {
  const base = profile.faultSeverityOverrides?.[code] ?? FAULTS[code].severity;
  if (proposed === undefined) return base;
  // A proposed severity replaces the catalogue default but still respects a jurisdiction override that is stricter.
  const override = profile.faultSeverityOverrides?.[code];
  return override && RANK[override] > RANK[proposed] ? override : proposed;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Mark a drive under the jurisdiction's road-test scheme. */
export function scoreFaults(faults: readonly Fault[], profile: JurisdictionProfile): ScoreSummary {
  const s = profile.roadTest.scoring;
  let minor = 0;
  let serious = 0;
  let dangerous = 0;
  for (const f of faults) {
    if (f.severity === 'minor') minor++;
    else if (f.severity === 'serious') serious++;
    else dangerous++;
  }
  const points = minor * s.pointsPerMinor + (s.seriousIsAutoFail ? 0 : serious * s.pointsPerSerious);
  const failReasons: string[] = [];
  if (dangerous) failReasons.push(`${plural(dangerous, 'dangerous fault')} — any dangerous fault fails the test`);
  if (serious && s.seriousIsAutoFail) failReasons.push(`${plural(serious, 'serious fault')} — a single serious fault fails the test`);
  if (points > s.maxPoints) {
    failReasons.push(s.style === 'fault_count' ? `${plural(minor, 'minor fault')} — more than the ${s.maxPoints} allowed` : `${points} points — more than the ${s.maxPoints} allowed`);
  }
  const headline =
    s.style === 'fault_count'
      ? `${plural(minor, 'minor fault')} (${s.maxPoints} allowed) · ${serious} serious · ${dangerous} dangerous`
      : `${points} of ${s.maxPoints} points used · ${serious} serious · ${dangerous} dangerous`;
  return { minor, serious, dangerous, points, maxPoints: s.maxPoints, passed: failReasons.length === 0, failReasons, headline };
}

/**
 * 0–3 stars: 3 = clean enough to pass with at most two minors, 2 = pass,
 * 1 = finished but with faults that would fail, 0 = dangerous fault or not finished.
 */
export function starsFor(score: ScoreSummary, completed: boolean): 0 | 1 | 2 | 3 {
  if (!completed || score.dangerous > 0) return 0;
  if (!score.passed) return 1;
  return score.minor <= 2 ? 3 : 2;
}

export const CATEGORY_LABELS: Record<FaultCategory, string> = {
  observation: 'Observation',
  signals: 'Signalling',
  speed: 'Speed',
  positioning: 'Road position',
  junctions: 'Junctions & signals',
  right_of_way: 'Giving way',
  control: 'Car control',
  manoeuvres: 'Manoeuvres',
  safety: 'Safety',
};

/** Faults grouped by category for the results screen, worst categories first. */
export function summariseFaults(faults: readonly Fault[]): { category: FaultCategory; label: string; minor: number; serious: number; dangerous: number; faults: Fault[] }[] {
  const groups = new Map<FaultCategory, { category: FaultCategory; label: string; minor: number; serious: number; dangerous: number; faults: Fault[] }>();
  for (const f of faults) {
    let g = groups.get(f.category);
    if (!g) groups.set(f.category, (g = { category: f.category, label: CATEGORY_LABELS[f.category], minor: 0, serious: 0, dangerous: 0, faults: [] }));
    g[f.severity]++;
    g.faults.push(f);
  }
  const weight = (g: { minor: number; serious: number; dangerous: number }): number => g.dangerous * 100 + g.serious * 10 + g.minor;
  return [...groups.values()].sort((a, b) => weight(b) - weight(a));
}
