import type { AppSettings, SessionSettings } from '../core/types';
import { DEFAULT_JURISDICTION_ID, JURISDICTIONS, guessJurisdictionId } from '../jurisdictions';

const KEY = 'learner-lane/settings/v1';

export const DEFAULT_SESSION: SessionSettings = {
  weather: 'clear',
  timeOfDay: 'day',
  traffic: 'normal',
  pedestrians: 'few',
  feedback: 'coach',
  observation: 'relaxed',
  seed: 1,
};

export function defaultSettings(locale?: string): AppSettings {
  return {
    jurisdictionId: locale ? guessJurisdictionId(locale) : DEFAULT_JURISDICTION_ID,
    speedUnit: 'auto',
    graphics: 'medium',
    showMirrors: true,
    camera: 'chase',
    volume: 0.7,
    voice: false,
    navLine: true,
    touchControls: 'auto',
    steeringSensitivity: 1,
    reducedMotion: false,
    highContrast: false,
    textScale: 1,
    session: { ...DEFAULT_SESSION },
    onboarded: false,
  };
}

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(fn: (value: T) => void): () => void;
}

/** Settings persisted in localStorage; tolerant of missing/blocked storage and old shapes. */
export function createSettingsStore(): Store<AppSettings> {
  const locale = typeof navigator !== 'undefined' ? navigator.language : undefined;
  let value = defaultSettings(locale);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppSettings>;
      value = { ...value, ...saved, session: { ...value.session, ...(saved.session ?? {}) } };
      if (!JURISDICTIONS.some((j) => j.id === value.jurisdictionId)) value.jurisdictionId = DEFAULT_JURISDICTION_ID;
    }
  } catch {
    /* storage unavailable: run with defaults */
  }
  const subs = new Set<(v: AppSettings) => void>();
  return {
    get: () => value,
    set(patch) {
      value = { ...value, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(value));
      } catch {
        /* ignore */
      }
      subs.forEach((fn) => fn(value));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
