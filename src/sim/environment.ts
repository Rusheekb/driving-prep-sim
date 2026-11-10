/**
 * Driving conditions for a session, derived from the weather and time-of-day
 * settings and the jurisdiction's lighting rules.
 */

import type { EnvironmentState, JurisdictionProfile, SessionSettings, TimeOfDay, Weather } from '../core/types';

/** Tyre grip multiplier by weather (1 = dry tarmac). */
const GRIP: Record<Weather, number> = { clear: 1.0, rain: 0.7, fog: 0.9 };

/** How far the driver can see in daylight in each kind of weather, metres. */
const WEATHER_RANGE: Record<Weather, number> = { clear: 600, rain: 250, fog: 70 };

/** How far the driver can see in clear air at each time of day, metres. */
const LIGHT_RANGE: Record<TimeOfDay, number> = { day: 600, dusk: 350, night: 180 };

const CLEAR_DAY_RANGE = 600;

export function createEnvironment(
  settings: Pick<SessionSettings, 'weather' | 'timeOfDay'>,
  profile: Pick<JurisdictionProfile, 'rules'>,
): EnvironmentState {
  const { weather, timeOfDay } = settings;
  const dark = timeOfDay !== 'day';
  const rain = weather === 'rain';

  // Losses from weather and from fading light stack like extinction
  // coefficients (reciprocal ranges add), so rain at night is worse than either
  // alone while each on its own keeps its plain figure.
  const visibility = Math.round(
    1 / (1 / WEATHER_RANGE[weather] + 1 / LIGHT_RANGE[timeOfDay] - 1 / CLEAR_DAY_RANGE),
  );

  return {
    weather,
    timeOfDay,
    grip: GRIP[weather],
    visibility,
    headlightsRequired: dark || weather === 'fog' || (rain && profile.rules.headlightsInRain),
    wipersRequired: rain,
  };
}
