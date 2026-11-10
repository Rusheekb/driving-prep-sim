import type { SpeedUnit } from './types';

export const MPH_TO_MPS = 0.44704;
export const KMH_TO_MPS = 1 / 3.6;
export const FEET_TO_M = 0.3048;

/** Convert a speed in the given display unit to m/s. */
export const toMps = (value: number, unit: SpeedUnit): number => value * (unit === 'mph' ? MPH_TO_MPS : KMH_TO_MPS);

/** Convert m/s to the given display unit. */
export const fromMps = (mps: number, unit: SpeedUnit): number => mps / (unit === 'mph' ? MPH_TO_MPS : KMH_TO_MPS);

/** "25 mph" / "50 km/h" */
export const formatSpeed = (mps: number, unit: SpeedUnit): string => `${Math.round(fromMps(mps, unit))} ${unit}`;

/**
 * Format a distance the way a local would say it: feet/yards/miles alongside
 * mph, metres/kilometres alongside km/h.
 */
export function formatDistance(metres: number, unit: SpeedUnit): string {
  if (unit === 'mph') {
    const feet = metres / FEET_TO_M;
    if (feet < 1000) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
    const miles = metres / 1609.344;
    return `${miles.toFixed(1)} mi`;
  }
  if (metres < 1000) return `${Math.max(5, Math.round(metres / 5) * 5)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}
