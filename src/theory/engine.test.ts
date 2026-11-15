import { describe, expect, it } from 'vitest';
import { JURISDICTIONS } from '../jurisdictions';
import { buildQuiz, getQuestionBank, gradeQuiz } from './engine';

describe.each(JURISDICTIONS.map((p) => [p.id, p] as const))('theory bank for %s', (_id, profile) => {
  const bank = getQuestionBank(profile);
  it('has well-formed questions', () => {
    expect(bank.length).toBeGreaterThan(50);
    const ids = new Set<string>();
    for (const q of bank) {
      expect(ids.has(q.id), q.id).toBe(false);
      ids.add(q.id);
      expect(q.options.length, q.id).toBeGreaterThanOrEqual(3);
      expect(q.options.length, q.id).toBeLessThanOrEqual(4);
      expect(new Set(q.options).size, q.id).toBe(q.options.length);
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(q.options.length);
      for (const text of [q.text, q.explanation, ...q.options]) {
        expect(text.length, q.id).toBeGreaterThan(0);
        expect(/undefined|NaN/.test(text), `${q.id}: ${text}`).toBe(false);
      }
    }
  });
  it('builds and grades quizzes deterministically', () => {
    const a = buildQuiz(profile, 'mock', 3);
    const b = buildQuiz(profile, 'mock', 3);
    expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id));
    expect(a.passMark).not.toBeNull();
    const original = new Map(bank.map((q) => [q.id, q]));
    for (const q of a.questions) expect(q.options[q.answer]).toBe(original.get(q.id)!.options[original.get(q.id)!.answer]);
    const perfect = gradeQuiz(profile, a, a.questions.map((q) => q.answer), 0);
    expect(perfect.result.correct).toBe(a.questions.length);
    expect(perfect.result.passed).toBe(true);
    const none = gradeQuiz(profile, a, a.questions.map(() => null), 0);
    expect(none.result.passed).toBe(false);
    expect(none.missedIds.length).toBe(a.questions.length);
    expect(buildQuiz(profile, 'signs', 1).questions.every((q) => q.sign)).toBe(true);
  });
});
