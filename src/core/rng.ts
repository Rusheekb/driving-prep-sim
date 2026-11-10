import type { Rng } from './types';

/**
 * Small, fast, seedable PRNG (mulberry32). The simulation must take ALL of its
 * randomness from an `Rng` so that sessions are reproducible in tests.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0 || 0x9e3779b9;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
    fork: () => createRng(Math.floor(next() * 4294967296)),
  };
  return rng;
}
