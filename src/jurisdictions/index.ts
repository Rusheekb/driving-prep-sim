import type { JurisdictionProfile } from '../core/types';

/**
 * Every `*.ts` file in this folder that exports a JurisdictionProfile is
 * picked up automatically, so adding a region is just adding a file.
 */
const modules = import.meta.glob<Record<string, unknown>>(['./*.ts', '!./index.ts', '!./*.test.ts'], { eager: true });

const isProfile = (v: unknown): v is JurisdictionProfile =>
  typeof v === 'object' && v !== null && typeof (v as JurisdictionProfile).id === 'string' && typeof (v as JurisdictionProfile).drivingSide === 'string' && typeof (v as JurisdictionProfile).roadTest === 'object';

/** Every jurisdiction the simulator knows, ordered by country then name. */
export const JURISDICTIONS: readonly JurisdictionProfile[] = Object.values(modules)
  .flatMap((m) => Object.values(m).filter(isProfile))
  .sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));

export const DEFAULT_JURISDICTION_ID = 'us-ca';

const BY_ID = new Map(JURISDICTIONS.map((p) => [p.id, p]));

/** Profile by id; falls back to the default for unknown ids. */
export function getJurisdiction(id: string | null | undefined): JurisdictionProfile {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_JURISDICTION_ID) || JURISDICTIONS[0]!;
}

/** Profiles grouped by country for the region picker. */
export const JURISDICTION_GROUPS: readonly { country: string; flag: string; profiles: JurisdictionProfile[] }[] = (() => {
  const groups = new Map<string, { country: string; flag: string; profiles: JurisdictionProfile[] }>();
  for (const p of JURISDICTIONS) {
    let g = groups.get(p.country);
    if (!g) groups.set(p.country, (g = { country: p.country, flag: p.flag, profiles: [] }));
    g.profiles.push(p);
  }
  return [...groups.values()];
})();

/** Best default profile for a browser locale such as 'en-GB' (pure; pass `navigator.language`). */
export function guessJurisdictionId(locale: string | undefined): string {
  const region = (locale ?? '').split('-')[1]?.toUpperCase();
  if (region) {
    const match = JURISDICTIONS.find((p) => p.countryCode === region);
    if (match) return match.id;
  }
  return DEFAULT_JURISDICTION_ID;
}
