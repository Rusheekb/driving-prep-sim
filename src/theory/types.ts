import type { SignKind } from '../signs';

export type TheoryCategory =
  | 'signs'
  | 'rules_of_the_road'
  | 'priority'
  | 'speed'
  | 'safe_driving'
  | 'parking'
  | 'alcohol_drugs'
  | 'vulnerable_road_users'
  | 'conditions'
  | 'vehicle_and_documents'
  | 'emergencies';

export interface Question {
  /** Unique, stable id, e.g. 'us-ca/023' or 'gen/following-gap'. */
  id: string;
  category: TheoryCategory;
  text: string;
  /** 3 or 4 options. */
  options: string[];
  /** Index into `options` of the single correct answer. */
  answer: number;
  /** Why the answer is right (1–3 sentences) — shown after answering. */
  explanation: string;
  /** Optional road sign shown with the question. */
  sign?: { kind: SignKind; value?: number };
  /** Where a learner can read more, e.g. 'California Driver Handbook — Speed limits'. */
  reference?: string;
}

/**
 * A hand-written, fact-checked question bank for one jurisdiction.
 * Each file in `src/theory/banks/` default-exports one of these.
 */
export interface QuestionBank {
  jurisdictionId: string;
  questions: Question[];
}
