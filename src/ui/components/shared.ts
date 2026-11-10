/**
 * Types and small helpers shared by the component files.
 * Import components from `src/ui/components` (the barrel), not from here.
 */
import type { AttrValue, Child, ClassValue } from '../dom';
import type { IconName } from '../icons';

/** Semantic tone, taken from signals and signs. Always paired with an icon or label — never colour alone. */
export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'bad';
/** A tone, or the brand accent (lane-marking yellow). */
export type ToneOrAccent = Tone | 'accent';
export type Size = 'sm' | 'md' | 'lg';

/** Anything renderable: a string, number, Node, array of those, or `null` / `false` for nothing. */
export type Content = Child;

/** Options every component accepts for one-off tweaks. */
export interface BaseOptions {
  /** Extra class name(s) for the root element. */
  class?: ClassValue;
  /** Extra attributes for the root element (`id`, `aria-*`, `data-*`, `autofocus`, …). */
  attrs?: Record<string, AttrValue>;
}

/** Imperative handle mixed into stateful form controls. `setValue` never fires `onChange`. */
export interface Control<T> {
  getValue(): T;
  setValue(value: T): void;
  setDisabled(disabled: boolean): void;
}

/** Default icon for each tone (so tone is never signalled by colour alone). */
export const TONE_ICON: Record<Tone, IconName> = {
  neutral: 'info',
  info: 'info',
  good: 'check-circle',
  warn: 'warning-triangle',
  bad: 'x-circle',
};

/**
 * Index to move to for an arrow / Home / End key press in a roving-tabindex
 * group, or `null` when the key is not a navigation key. Wraps around.
 * `disabled` marks entries to skip.
 */
export function nextRovingIndex(
  key: string,
  current: number,
  count: number,
  opts: { orientation?: 'horizontal' | 'vertical' | 'both'; rtl?: boolean; disabled?: readonly boolean[] } = {},
): number | null {
  if (count <= 0) return null;
  const orientation = opts.orientation ?? 'both';
  const horizontal = orientation !== 'vertical';
  const vertical = orientation !== 'horizontal';
  let step = 0;
  let start = current;
  if (horizontal && key === 'ArrowRight') step = opts.rtl ? -1 : 1;
  else if (horizontal && key === 'ArrowLeft') step = opts.rtl ? 1 : -1;
  else if (vertical && key === 'ArrowDown') step = 1;
  else if (vertical && key === 'ArrowUp') step = -1;
  else if (key === 'Home') {
    step = 1;
    start = -1;
  } else if (key === 'End') {
    step = -1;
    start = count;
  } else return null;

  let index = start;
  for (let i = 0; i < count; i++) {
    index = (index + step + count) % count;
    if (!opts.disabled?.[index]) return index;
  }
  return null;
}

/** True when `el` lays out right-to-left. */
export function isRtl(el: Element): boolean {
  return getComputedStyle(el).direction === 'rtl';
}
