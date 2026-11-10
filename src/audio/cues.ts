/**
 * Edge detection for the sounds that repeat on a cycle: the indicator relay
 * and the windscreen wipers. Pure functions — the audio graph keeps the tiny
 * bit of state they return and schedules a one-shot whenever a cue fires.
 */
import { blinkOn } from '../core/constants';
import type { IndicatorState } from '../core/types';

export type RelayCue = 'tick' | 'tock';

/**
 * The flasher relay clicks each time the indicator lamps change state:
 * "tick" as they light, "tock" as they go dark. The lamps follow
 * `blinkOn(time)`, the same function the renderer and HUD use, so sound and
 * light stay locked together. Hazard lights use the same relay.
 *
 * @param wasLit `lit` returned by the previous call (false to start with)
 * @param time   simulation time, s
 */
export function indicatorCue(
  wasLit: boolean,
  indicator: IndicatorState,
  time: number,
): { lit: boolean; cue: RelayCue | null } {
  const active = indicator !== 'off';
  const lit = active && Number.isFinite(time) && blinkOn(time);
  if (lit && !wasLit) return { lit, cue: 'tick' };
  // Cancelling the indicator mid-flash is silent: the stalk click is the feedback for that.
  if (!lit && wasLit && active) return { lit, cue: 'tock' };
  return { lit, cue: null };
}

/** Seconds for the wipers to sweep across the screen and back, including the short park pause. */
export const WIPER_PERIOD = 1.4;

/**
 * Decides when the next wiper sweep should sound. The first sweep starts the
 * moment the wipers are switched on; after that one starts every
 * `WIPER_PERIOD`. A sweep in progress always finishes (as on a real car), so
 * flicking the switch off and on cannot stack two sweeps on top of each other.
 *
 * @param cooldown seconds until another sweep may start (0 to start with)
 * @param dt       seconds since the previous call
 */
export function wiperCue(cooldown: number, wipers: boolean, dt: number): { cooldown: number; sweep: boolean } {
  const elapsed = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const remaining = Math.max(0, cooldown - elapsed);
  if (wipers && remaining <= 0) return { cooldown: WIPER_PERIOD, sweep: true };
  return { cooldown: remaining, sweep: false };
}
