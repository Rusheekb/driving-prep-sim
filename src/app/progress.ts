import type { JurisdictionProfile, ProgressData, ScenarioMeta, SessionResult, TheoryResult } from '../core/types';

const KEY = 'learner-lane/progress/v1';

export interface Readiness {
  /** 0..1 */
  score: number;
  factors: { label: string; value: number; detail: string }[];
}

export interface ProgressStore {
  get(): ProgressData;
  recordSession(result: SessionResult): void;
  recordTheory(result: TheoryResult, missedIds: readonly string[], correctIds: readonly string[]): void;
  bestFor(jurisdictionId: string, scenarioId: string): ProgressData['best'][string] | null;
  /** How ready the learner looks for the real test in this region, from what they have done here. */
  readiness(profile: JurisdictionProfile, scenarios: readonly ScenarioMeta[]): Readiness;
  reset(): void;
  subscribe(fn: () => void): () => void;
}

const empty = (): ProgressData => ({ version: 1, best: {}, history: [], faultCounts: {}, theory: [], theoryMissed: [], totals: { sessions: 0, distanceM: 0, timeS: 0 } });

export function createProgressStore(): ProgressStore {
  let data = empty();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) data = { ...empty(), ...(JSON.parse(raw) as ProgressData) };
  } catch {
    /* storage unavailable */
  }
  const subs = new Set<() => void>();
  const save = (): void => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
    subs.forEach((fn) => fn());
  };
  const rank = (o: string): number => (o === 'passed' ? 3 : o === 'completed' ? 2 : o === 'failed' ? 1 : 0);
  return {
    get: () => data,
    recordSession(r) {
      data.totals.sessions++;
      data.totals.distanceM += r.distanceM;
      data.totals.timeS += r.durationS;
      for (const f of r.faults) data.faultCounts[f.code] = (data.faultCounts[f.code] ?? 0) + 1;
      data.history.unshift({ scenarioId: r.scenarioId, scenarioTitle: r.scenarioTitle, category: r.category, jurisdictionId: r.jurisdictionId, finishedAt: r.finishedAt, outcome: r.outcome, stars: r.stars, durationS: r.durationS });
      data.history.length = Math.min(data.history.length, 40);
      if (r.outcome !== 'aborted' && r.category !== 'free') {
        const key = `${r.jurisdictionId}/${r.scenarioId}`;
        const prev = data.best[key];
        if (!prev || r.stars > prev.stars || (r.stars === prev.stars && rank(r.outcome) > rank(prev.outcome))) {
          data.best[key] = { stars: r.stars, outcome: r.outcome, faults: r.faults.length, at: r.finishedAt };
        }
      }
      save();
    },
    recordTheory(r, missed, correct) {
      data.theory.unshift(r);
      data.theory.length = Math.min(data.theory.length, 30);
      const set = new Set(data.theoryMissed ?? []);
      for (const id of correct) set.delete(id);
      for (const id of missed) set.add(id);
      data.theoryMissed = [...set].slice(-200);
      save();
    },
    bestFor: (jid, sid) => data.best[`${jid}/${sid}`] ?? null,
    readiness(profile, scenarios) {
      const done = (m: ScenarioMeta, minStars: number): boolean => {
        const b = data.best[`${profile.id}/${m.id}`];
        return !!b && b.stars >= minStars && b.outcome !== 'failed';
      };
      const lessons = scenarios.filter((s) => s.category === 'lesson');
      const skills = scenarios.filter((s) => s.category === 'skill');
      const lessonsDone = lessons.filter((m) => done(m, 1)).length;
      const skillsDone = skills.filter((m) => done(m, 2)).length;
      const testPassed = scenarios.some((s) => s.category === 'test' && data.best[`${profile.id}/${s.id}`]?.outcome === 'passed');
      const theoryPassed = data.theory.some((t) => t.jurisdictionId === profile.id && t.passed && t.total >= Math.min(20, profile.knowledgeTest.questionCount));
      const factors = [
        { label: 'Lessons completed', value: lessons.length ? lessonsDone / lessons.length : 0, detail: `${lessonsDone} of ${lessons.length}` },
        { label: 'Skills at two stars or better', value: skills.length ? skillsDone / skills.length : 0, detail: `${skillsDone} of ${skills.length}` },
        { label: 'Mock road test passed', value: testPassed ? 1 : 0, detail: testPassed ? 'Passed' : 'Not yet' },
        { label: 'Theory mock passed', value: theoryPassed ? 1 : 0, detail: theoryPassed ? 'Passed' : 'Not yet' },
      ];
      const score = factors[0]!.value * 0.35 + factors[1]!.value * 0.2 + factors[2]!.value * 0.3 + factors[3]!.value * 0.15;
      return { score, factors };
    },
    reset() {
      data = empty();
      save();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
