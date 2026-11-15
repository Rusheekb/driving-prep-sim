/**
 * Display components: Card, Chip, Badge, SeverityChip, ProgressBar, Stars,
 * Meter, StatTile, EmptyState, KeyCap / keys / withKeyCaps, Tooltip, Skeleton,
 * Spinner, Divider, Banner (Callout), List / ListItem, PageHeader.
 */
import type { Severity } from '../../core/types';
import { clamp, frag, h, mount, svg, uid } from '../dom';
import type { Child } from '../dom';
import { icon } from '../icons';
import type { IconName } from '../icons';
import { TONE_ICON } from './shared';
import type { BaseOptions, Content, Tone, ToneOrAccent } from './shared';

/* ========================================================================== */
/* Card                                                                       */
/* ========================================================================== */

export interface CardOptions extends BaseOptions {
  title?: Content;
  /** Short secondary line under the title. */
  subtitle?: Content;
  /** Free-form content under the title block. */
  body?: Content;
  /** Micro label above the title (uppercase). */
  eyebrow?: string;
  /** Icon shown in a tinted tile (the media slot). */
  icon?: IconName;
  /** Custom media instead of an icon tile: sign artwork, an illustration, a Meter… */
  media?: Node;
  /** Corner badge — a `Badge()` / `Chip()` node, or a string (rendered as a neutral Badge). */
  badge?: Content;
  /** Footer slot (progress bar, stars, meta row…). */
  footer?: Content;
  /** Tints the icon tile. Default `accent`. */
  tone?: ToneOrAccent;
  /** `vertical` (default): media above the text. `horizontal`: media beside it. */
  layout?: 'vertical' | 'horizontal';
  /** Makes the whole card one button (keyboard-focusable; the title is its accessible name). */
  onClick?: (event: MouseEvent) => void;
  /** Makes the whole card a link instead. */
  href?: string;
  /** Selected look for interactive cards. */
  selected?: boolean;
  /** Interactive cards only: looks locked and ignores clicks, but stays discoverable (`aria-disabled`). */
  disabled?: boolean;
  /** Heading level of the title (default 3). */
  headingLevel?: 2 | 3 | 4;
}

/**
 * A surface that groups related content. With `onClick` or `href` the whole
 * card becomes one large target while its footer can still hold other content.
 *
 * ```ts
 * Card({ icon: 'clipboard-check', title: 'Mock test', subtitle: 'A full examiner-marked drive',
 *        badge: Badge({ label: '25 min' }), footer: ProgressBar({ label: 'Best score', value: 80 }),
 *        onClick: () => openMockTest() })
 * ```
 */
export function Card(opts: CardOptions): HTMLElement {
  const interactive = Boolean(opts.onClick || opts.href);
  const subtitleId = opts.subtitle ? uid('ll-card-sub') : undefined;

  let titleContent: Child = opts.title;
  if (interactive && opts.title !== undefined) {
    titleContent = opts.href
      ? h('a', { class: 'll-card__action', href: opts.href, 'aria-describedby': subtitleId }, opts.title)
      : h(
          'button',
          {
            class: 'll-card__action',
            type: 'button',
            'aria-describedby': subtitleId,
            'aria-disabled': opts.disabled ? true : undefined,
            'aria-pressed': opts.selected === undefined ? undefined : opts.selected,
            onClick: (event) => {
              if (opts.disabled) {
                event.preventDefault();
                return;
              }
              opts.onClick?.(event);
            },
          },
          opts.title,
        );
  }

  const media = opts.media
    ? h('div', { class: 'll-card__media' }, opts.media)
    : opts.icon
      ? h('div', { class: 'll-card__media' }, h('span', { class: 'll-icon-tile', 'data-tone': opts.tone ?? 'accent' }, icon(opts.icon)))
      : null;

  const badge =
    opts.badge !== undefined && opts.badge !== null && opts.badge !== false
      ? h('div', { class: 'll-card__badge' }, typeof opts.badge === 'string' ? Badge({ label: opts.badge }) : opts.badge)
      : null;

  return h(
    'article',
    {
      ...opts.attrs,
      class: [
        'll-card',
        `ll-card--${opts.layout ?? 'vertical'}`,
        {
          'll-card--interactive': interactive,
          'is-selected': Boolean(opts.selected),
          'is-disabled': Boolean(opts.disabled),
        },
        opts.class,
      ],
    },
    (media || badge) && h('div', { class: 'll-card__top' }, media, badge),
    h(
      'div',
      { class: 'll-card__main' },
      opts.eyebrow && h('span', { class: 'll-eyebrow' }, opts.eyebrow),
      opts.title !== undefined && h(`h${opts.headingLevel ?? 3}`, { class: 'll-card__title' }, titleContent),
      opts.subtitle && h('p', { class: 'll-card__subtitle', id: subtitleId }, opts.subtitle),
      opts.body && h('div', { class: 'll-card__body' }, opts.body),
    ),
    opts.footer && h('div', { class: 'll-card__footer' }, opts.footer),
  );
}

/* ========================================================================== */
/* Chip, Badge                                                                */
/* ========================================================================== */

export interface ChipOptions extends BaseOptions {
  label: Content;
  tone?: ToneOrAccent;
  icon?: IconName;
  size?: 'sm' | 'md';
  /** Filled with the tone colour instead of tinted. */
  solid?: boolean;
}

/**
 * A pill label for status, categories and counts.
 * `Chip({ label: 'Passed', tone: 'good', icon: 'check' })`
 */
export function Chip(opts: ChipOptions): HTMLSpanElement {
  return h(
    'span',
    {
      ...opts.attrs,
      class: ['ll-chip', `ll-chip--${opts.size ?? 'md'}`, { 'll-chip--solid': Boolean(opts.solid) }, opts.class],
      'data-tone': opts.tone ?? 'neutral',
    },
    opts.icon && icon(opts.icon),
    h('span', { class: 'll-chip__label' }, opts.label),
  );
}

export interface BadgeOptions extends BaseOptions {
  label: Content;
  tone?: ToneOrAccent;
  solid?: boolean;
}

/**
 * A compact uppercase micro-label ("NEW", "LOCKED", "12 MIN").
 * `Badge({ label: 'New', tone: 'accent', solid: true })`
 */
export function Badge(opts: BadgeOptions): HTMLSpanElement {
  return h(
    'span',
    {
      ...opts.attrs,
      class: ['ll-badge', { 'll-badge--solid': Boolean(opts.solid) }, opts.class],
      'data-tone': opts.tone ?? 'neutral',
    },
    opts.label,
  );
}

const SEVERITY_CHIP: Record<Severity, { tone: Tone; icon: IconName; label: string; solid: boolean }> = {
  minor: { tone: 'warn', icon: 'warning-triangle', label: 'Minor', solid: false },
  serious: { tone: 'bad', icon: 'x-circle', label: 'Serious', solid: false },
  dangerous: { tone: 'bad', icon: 'hazard', label: 'Dangerous', solid: true },
};

/**
 * Chip for a fault severity (amber / red / solid red, each with its own icon).
 * Pass `label` to use the jurisdiction's wording (e.g. "Driving fault").
 */
export function SeverityChip(severity: Severity, label?: string): HTMLSpanElement {
  const spec = SEVERITY_CHIP[severity];
  return Chip({ label: label ?? spec.label, tone: spec.tone, icon: spec.icon, solid: spec.solid, size: 'sm' });
}

/* ========================================================================== */
/* ProgressBar                                                                */
/* ========================================================================== */

export interface ProgressBarOptions extends BaseOptions {
  /** Accessible name; also shown above the bar unless `showLabel` is false. */
  label: string;
  value: number;
  /** Default 100. */
  max?: number;
  showLabel?: boolean;
  /** Show the formatted value at the end of the label row (default true when the label is shown). */
  showValue?: boolean;
  /** Formats the value text. Default: a rounded percentage. */
  format?: (value: number, max: number) => string;
  /** Colour of the filled part. Default `accent`. */
  tone?: ToneOrAccent;
  size?: 'sm' | 'md' | 'lg';
  /** Split the bar into this many steps (e.g. `scenario.totalSteps`). */
  segments?: number;
}

export type ProgressBarElement = HTMLDivElement & { setValue(value: number, max?: number): void };

/**
 * Determinate progress. The empty part of the track is drawn as a dashed
 * centre line — the road still ahead.
 *
 * ```ts
 * const bar = ProgressBar({ label: 'Lesson progress', value: 2, max: 5, segments: 5, format: (v, m) => `${v} of ${m}` });
 * bar.setValue(3);
 * ```
 */
export function ProgressBar(opts: ProgressBarOptions): ProgressBarElement {
  let max = opts.max ?? 100;
  const format = opts.format ?? ((value: number, m: number) => `${Math.round((value / (m || 1)) * 100)}%`);
  const showLabel = opts.showLabel ?? true;
  const showValue = opts.showValue ?? showLabel;
  const fill = h('div', { class: 'll-progress__fill' });
  const valueEl = h('span', { class: 'll-progress__value ll-num' });
  const track = h(
    'div',
    {
      class: 'll-progress__track',
      role: 'progressbar',
      'aria-label': opts.label,
      'aria-valuemin': 0,
      style: opts.segments ? { '--ll-progress-segments': opts.segments } : undefined,
    },
    fill,
  );

  const el = h(
    'div',
    {
      ...opts.attrs,
      class: ['ll-progress', `ll-progress--${opts.size ?? 'md'}`, { 'll-progress--segmented': Boolean(opts.segments) }, opts.class],
      'data-tone': opts.tone ?? 'accent',
    },
    (showLabel || showValue) &&
      h(
        'div',
        { class: 'll-progress__head' },
        showLabel ? h('span', { class: 'll-progress__label' }, opts.label) : h('span'),
        showValue && valueEl,
      ),
    track,
  ) as ProgressBarElement;

  el.setValue = (value, nextMax) => {
    if (nextMax !== undefined) max = nextMax;
    const v = clamp(value, 0, max);
    const pct = max > 0 ? (v / max) * 100 : 0;
    fill.style.width = `${pct}%`;
    el.classList.toggle('is-complete', v >= max);
    track.setAttribute('aria-valuemax', String(max));
    track.setAttribute('aria-valuenow', String(v));
    const textValue = format(v, max);
    track.setAttribute('aria-valuetext', textValue);
    valueEl.textContent = textValue;
  };
  el.setValue(opts.value);
  return el;
}

/* ========================================================================== */
/* Stars                                                                      */
/* ========================================================================== */

export interface StarsOptions extends BaseOptions {
  /** Stars earned (0 … max). */
  value: number;
  /** Default 3. */
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Accessible label. Default "2 of 3 stars". */
  label?: string;
  /** Pop the earned stars in one after another (results screen). Ignored with reduced motion. */
  animate?: boolean;
}

/** Star rating display (0–3 by default): `Stars({ value: result.stars, size: 'lg', animate: true })`. */
export function Stars(opts: StarsOptions): HTMLSpanElement {
  const max = opts.max ?? 3;
  const value = clamp(Math.round(opts.value), 0, max);
  const stars: Child[] = [];
  for (let i = 0; i < max; i++) {
    const on = i < value;
    stars.push(
      h(
        'span',
        { class: ['ll-stars__star', on ? 'is-on' : 'is-off'], style: { '--ll-star-index': i } },
        icon(on ? 'star-filled' : 'star'),
      ),
    );
  }
  return h(
    'span',
    {
      ...opts.attrs,
      class: ['ll-stars', `ll-stars--${opts.size ?? 'md'}`, { 'll-stars--animate': Boolean(opts.animate) }, opts.class],
      role: 'img',
      'aria-label': opts.label ?? `${value} of ${max} stars`,
    },
    stars,
  );
}

/* ========================================================================== */
/* Meter (ring)                                                               */
/* ========================================================================== */

export interface MeterOptions extends BaseOptions {
  /** Accessible name, e.g. "Test readiness". */
  label: string;
  value: number;
  /** Default 100. */
  max?: number;
  /** Small text under the number inside the ring (e.g. "ready"). */
  caption?: string;
  /** Formats the number shown in the ring. Default: rounded percentage. */
  format?: (value: number, max: number) => string;
  /** Diameter in CSS px at the default text scale (default 132). */
  size?: number;
  /**
   * Ring colour. `auto` (default) picks red below 40 %, amber below 70 %, green
   * from there — the caption/number carry the meaning, the colour reinforces it.
   */
  tone?: ToneOrAccent | 'auto';
}

export type MeterElement = HTMLDivElement & { setValue(value: number): void };

/**
 * Circular progress ring with a number in the middle — used for "test readiness".
 *
 * ```ts
 * const ready = Meter({ label: 'Test readiness', value: 72, caption: 'ready' });
 * ready.setValue(80);
 * ```
 */
export function Meter(opts: MeterOptions): MeterElement {
  const max = opts.max ?? 100;
  const format = opts.format ?? ((value: number, m: number) => `${Math.round((value / (m || 1)) * 100)}%`);
  const ring = svg(
    '<svg viewBox="0 0 100 100" class="ll-meter__ring" aria-hidden="true" focusable="false">' +
      '<circle class="ll-meter__track" cx="50" cy="50" r="43" pathLength="100"/>' +
      '<circle class="ll-meter__arc" cx="50" cy="50" r="43" pathLength="100"/>' +
      '</svg>',
  );
  const arc = ring.querySelector<SVGCircleElement>('.ll-meter__arc')!;
  const valueEl = h('span', { class: 'll-meter__value ll-num' });

  const el = h(
    'div',
    {
      ...opts.attrs,
      class: ['ll-meter', opts.class],
      role: 'meter',
      'aria-label': opts.label,
      'aria-valuemin': 0,
      'aria-valuemax': max,
      style: { '--ll-meter-size': `${(opts.size ?? 132) / 16}rem` },
    },
    ring,
    h('div', { class: 'll-meter__center' }, valueEl, opts.caption && h('span', { class: 'll-meter__caption' }, opts.caption)),
  ) as MeterElement;

  el.setValue = (value) => {
    const v = clamp(value, 0, max);
    const fraction = max > 0 ? v / max : 0;
    const tone = opts.tone && opts.tone !== 'auto' ? opts.tone : fraction < 0.4 ? 'bad' : fraction < 0.7 ? 'warn' : 'good';
    el.dataset.tone = tone;
    // 0.001 keeps the round cap from drawing a dot at zero.
    arc.style.strokeDasharray = `${Math.max(fraction * 100, 0.001)} 100`;
    arc.style.opacity = fraction <= 0 ? '0' : '1';
    const textValue = format(v, max);
    valueEl.textContent = textValue;
    el.setAttribute('aria-valuenow', String(v));
    el.setAttribute('aria-valuetext', opts.caption ? `${textValue} ${opts.caption}` : textValue);
  };
  el.setValue(opts.value);
  return el;
}

/* ========================================================================== */
/* StatTile, EmptyState                                                       */
/* ========================================================================== */

export interface StatTileOptions extends BaseOptions {
  /** The big number (or short text). */
  value: Content;
  label: string;
  /** Small text after the value ("/ 15", "mph", "min"). */
  unit?: string;
  icon?: IconName;
  /** Colours the icon and value accent. */
  tone?: ToneOrAccent;
  /** Supporting line under the value. */
  hint?: Content;
}

/** A big number with a label: `StatTile({ label: 'Driving faults', value: 4, unit: '/ 15', icon: 'clipboard-check', tone: 'good' })`. */
export function StatTile(opts: StatTileOptions): HTMLDivElement {
  return h(
    'div',
    { ...opts.attrs, class: ['ll-stat', opts.class], 'data-tone': opts.tone ?? 'neutral' },
    h(
      'div',
      { class: 'll-stat__head' },
      h('span', { class: 'll-stat__label ll-eyebrow' }, opts.label),
      opts.icon && h('span', { class: 'll-stat__icon' }, icon(opts.icon)),
    ),
    h(
      'div',
      { class: 'll-stat__value ll-num' },
      opts.value,
      opts.unit && h('span', { class: 'll-stat__unit' }, opts.unit),
    ),
    opts.hint && h('div', { class: 'll-stat__hint' }, opts.hint),
  );
}

export interface EmptyStateOptions extends BaseOptions {
  icon?: IconName;
  title: string;
  message?: Content;
  /** Usually one Button. */
  action?: Content;
}

/** Friendly placeholder for "nothing here yet" (no history, no results for a filter…). */
export function EmptyState(opts: EmptyStateOptions): HTMLDivElement {
  return h(
    'div',
    { ...opts.attrs, class: ['ll-empty', opts.class] },
    opts.icon && h('span', { class: 'll-empty__icon' }, icon(opts.icon)),
    h('p', { class: 'll-empty__title' }, opts.title),
    opts.message && h('p', { class: 'll-empty__message' }, opts.message),
    opts.action && h('div', { class: 'll-empty__action' }, opts.action),
  );
}

/* ========================================================================== */
/* KeyCap                                                                     */
/* ========================================================================== */

const KEY_LABELS: Record<string, { text: string; spoken?: string }> = {
  arrowup: { text: '↑', spoken: 'Up arrow' },
  arrowdown: { text: '↓', spoken: 'Down arrow' },
  arrowleft: { text: '←', spoken: 'Left arrow' },
  arrowright: { text: '→', spoken: 'Right arrow' },
  up: { text: '↑', spoken: 'Up arrow' },
  down: { text: '↓', spoken: 'Down arrow' },
  left: { text: '←', spoken: 'Left arrow' },
  right: { text: '→', spoken: 'Right arrow' },
  ' ': { text: 'Space' },
  space: { text: 'Space' },
  spacebar: { text: 'Space' },
  escape: { text: 'Esc', spoken: 'Escape' },
  esc: { text: 'Esc', spoken: 'Escape' },
  enter: { text: 'Enter' },
  return: { text: 'Enter' },
  tab: { text: 'Tab' },
  shift: { text: 'Shift' },
  shiftleft: { text: 'Shift' },
  shiftright: { text: 'Shift' },
  control: { text: 'Ctrl', spoken: 'Control' },
  controlleft: { text: 'Ctrl', spoken: 'Control' },
  controlright: { text: 'Ctrl', spoken: 'Control' },
  ctrl: { text: 'Ctrl', spoken: 'Control' },
  alt: { text: 'Alt' },
  altleft: { text: 'Alt' },
  altright: { text: 'Alt' },
  backspace: { text: '⌫', spoken: 'Backspace' },
  comma: { text: ',', spoken: 'Comma' },
  period: { text: '.', spoken: 'Full stop' },
  slash: { text: '/', spoken: 'Slash' },
};

/**
 * Display text for a key. Accepts `KeyboardEvent.code` values (`'KeyW'`,
 * `'Digit1'`, `'ArrowUp'`, `'Space'`, `'Escape'`) as well as plain names
 * (`'W'`, `'Esc'`, `'Up'`). `spoken` is set when the glyph needs a
 * screen-reader name.
 */
export function keyLabel(key: string): { text: string; spoken?: string } {
  const known = KEY_LABELS[key.toLowerCase()];
  if (known) return known;
  const code = /^(?:Key([A-Z])|Digit(\d)|Numpad(\d))$/.exec(key);
  if (code) return { text: code[1] ?? code[2] ?? code[3] };
  return { text: key.length === 1 ? key.toUpperCase() : key };
}

/** A keyboard key: `KeyCap('W')`, `KeyCap('ArrowUp')`, `KeyCap('Space')`. */
export function KeyCap(key: string, opts: BaseOptions = {}): HTMLElement {
  const label = keyLabel(key);
  return h(
    'kbd',
    { ...opts.attrs, class: ['ll-kbd', { 'll-kbd--wide': label.text.length > 2 }, opts.class] },
    label.spoken ? [h('span', { 'aria-hidden': true }, label.text), h('span', { class: 'll-sr-only' }, label.spoken)] : label.text,
  );
}

/**
 * Several keys as one hint. Keys are alternatives separated by a slash by
 * default (`keys('W', 'ArrowUp')` → [W] / [↑]); pass `{ combo: true }` as the
 * last argument for a chord (`keys('Ctrl', 'R', { combo: true })` → [Ctrl] + [R]).
 */
export function keys(...names: (string | { combo: boolean })[]): HTMLSpanElement {
  const last = names[names.length - 1];
  const combo = typeof last === 'object' ? last.combo : false;
  const list = names.filter((name): name is string => typeof name === 'string');
  const parts: Child[] = [];
  list.forEach((name, index) => {
    if (index > 0) {
      parts.push(
        h('span', { class: 'll-keys__sep', 'aria-hidden': true }, combo ? '+' : '/'),
        h('span', { class: 'll-sr-only' }, combo ? ' plus ' : ' or '),
      );
    }
    parts.push(KeyCap(name));
  });
  return h('span', { class: 'll-keys' }, parts);
}

/** Split text such as `"Press [Q] to signal left"` into plain strings and `{ key }` tokens. */
export function parseKeyHints(textWithKeys: string): (string | { key: string })[] {
  const out: (string | { key: string })[] = [];
  const pattern = /\[([^\][]{1,12})\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(textWithKeys))) {
    if (match.index > last) out.push(textWithKeys.slice(last, match.index));
    out.push({ key: match[1] });
    last = match.index + match[0].length;
  }
  if (last < textWithKeys.length) out.push(textWithKeys.slice(last));
  return out;
}

/**
 * Render coaching text that contains key names in square brackets
 * (`ScenarioState.coach`, e.g. `"Press [Q] to signal left"`) with real key caps.
 */
export function withKeyCaps(textWithKeys: string): DocumentFragment {
  return frag(parseKeyHints(textWithKeys).map((part) => (typeof part === 'string' ? part : KeyCap(part.key))));
}

/* ========================================================================== */
/* Tooltip, Skeleton, Spinner, Divider                                        */
/* ========================================================================== */

/**
 * Attach a CSS-only tooltip (shown on hover and keyboard focus) to `target`.
 * If the element has no accessible name yet, the text also becomes its
 * `aria-label`. Returns `target`.
 *
 * Markup equivalent: `<button data-tooltip="Pause" data-tooltip-pos="bottom">`.
 */
export function Tooltip<T extends HTMLElement>(target: T, tip: string, pos: 'top' | 'bottom' | 'left' | 'right' = 'top'): T {
  target.setAttribute('data-tooltip', tip);
  target.setAttribute('data-tooltip-pos', pos);
  if (!target.hasAttribute('aria-label') && !target.hasAttribute('aria-labelledby') && !target.textContent?.trim()) {
    target.setAttribute('aria-label', tip);
  }
  return target;
}

export interface SkeletonOptions extends BaseOptions {
  /** `text` (default) one or more lines, `block` a rectangle, `circle` an avatar/icon. */
  shape?: 'text' | 'block' | 'circle';
  /** Any CSS length. */
  width?: string;
  height?: string;
  /** Number of text lines (shape `text`). */
  lines?: number;
}

/** Loading placeholder that mirrors the shape of the content to come. Hidden from assistive technology. */
export function Skeleton(opts: SkeletonOptions = {}): HTMLElement {
  const shape = opts.shape ?? 'text';
  const lines = shape === 'text' ? Math.max(1, opts.lines ?? 1) : 1;
  const bar = (last: boolean): HTMLElement =>
    h('span', {
      class: ['ll-skeleton', `ll-skeleton--${shape}`],
      style: { width: last && lines > 1 ? '62%' : opts.width, height: opts.height },
    });
  if (lines === 1) {
    const el = bar(false);
    el.setAttribute('aria-hidden', 'true');
    if (opts.class) el.classList.add(...String(opts.class).split(' ').filter(Boolean));
    return el;
  }
  return h(
    'span',
    { ...opts.attrs, class: ['ll-skeleton-lines', opts.class], 'aria-hidden': true },
    Array.from({ length: lines }, (_, i) => bar(i === lines - 1)),
  );
}

export interface SpinnerOptions extends BaseOptions {
  /** Diameter in CSS px at the default text scale (default 24). */
  size?: number;
  /** Screen-reader text (default "Loading"). Pass `''` for a purely decorative spinner. */
  label?: string;
}

/** Indeterminate loading indicator (a spinning dashed lane ring; pulses instead when motion is reduced). */
export function Spinner(opts: SpinnerOptions = {}): HTMLSpanElement {
  const label = opts.label ?? 'Loading';
  return h(
    'span',
    {
      ...opts.attrs,
      class: ['ll-spinner-wrap', opts.class],
      role: label ? 'status' : undefined,
      'aria-hidden': label ? undefined : true,
      style: opts.size ? { '--ll-spinner-size': `${opts.size / 16}rem` } : undefined,
    },
    h('span', { class: 'll-spinner', 'aria-hidden': true }),
    label && h('span', { class: 'll-sr-only' }, label),
  );
}

export interface DividerOptions extends BaseOptions {
  /** `line` (default) a hairline; `lane` the dashed centre-line motif. */
  variant?: 'line' | 'lane';
  /** Optional text in the middle ("or", a section name). */
  label?: string;
  /** Vertical divider for use inside a `.ll-row`. */
  vertical?: boolean;
}

/** A separator: `Divider()`, `Divider({ variant: 'lane' })`, `Divider({ label: 'or' })`. */
export function Divider(opts: DividerOptions = {}): HTMLElement {
  const classes = [
    'll-divider',
    `ll-divider--${opts.variant ?? 'line'}`,
    { 'll-divider--vertical': Boolean(opts.vertical), 'll-divider--labelled': Boolean(opts.label) },
    opts.class,
  ];
  if (opts.label) {
    return h('div', { ...opts.attrs, class: classes, role: 'separator' }, h('span', { class: 'll-divider__label' }, opts.label));
  }
  return h('hr', {
    ...opts.attrs,
    class: classes,
    'aria-orientation': opts.vertical ? 'vertical' : undefined,
  });
}

/* ========================================================================== */
/* Banner / Callout                                                           */
/* ========================================================================== */

export interface BannerOptions extends BaseOptions {
  /** Default `info`. */
  tone?: Tone;
  title?: Content;
  message?: Content;
  /** Overrides the tone's default icon; `false` hides it. */
  icon?: IconName | false;
  /** Buttons or links shown under the message. */
  actions?: Content;
  /** Extra content at the far end (Stars, a Meter, a Chip…). */
  aside?: Content;
  /** `lg` is the headline treatment used for a pass / fail result. */
  size?: 'md' | 'lg';
  /** Shows a close button; called after the banner removes itself. */
  onDismiss?: () => void;
  /** Announce to screen readers when inserted (`role="status"`, or `"alert"` for warn/bad). Default false. */
  live?: boolean;
}

/**
 * An inline message block: tips, legal notes, warnings, the pass/fail headline.
 *
 * ```ts
 * Banner({ tone: 'warn', title: 'Rules differ by region', message: 'Turning on red is not allowed here.' })
 * Banner({ tone: 'good', size: 'lg', icon: 'trophy', title: 'Test passed', message: score.headline, aside: Stars({ value: 3 }) })
 * ```
 */
export function Banner(opts: BannerOptions): HTMLDivElement {
  const tone = opts.tone ?? 'info';
  const iconName = opts.icon === false ? null : (opts.icon ?? TONE_ICON[tone]);
  const el = h(
    'div',
    {
      ...opts.attrs,
      class: ['ll-banner', `ll-banner--${opts.size ?? 'md'}`, opts.class],
      'data-tone': tone,
      role: opts.live ? (tone === 'warn' || tone === 'bad' ? 'alert' : 'status') : 'note',
    },
    iconName && h('span', { class: 'll-banner__icon' }, icon(iconName)),
    h(
      'div',
      { class: 'll-banner__content' },
      opts.title && h('p', { class: 'll-banner__title' }, opts.title),
      opts.message && h('div', { class: 'll-banner__message' }, opts.message),
      opts.actions && h('div', { class: 'll-banner__actions' }, opts.actions),
    ),
    opts.aside && h('div', { class: 'll-banner__aside' }, opts.aside),
    opts.onDismiss &&
      h(
        'button',
        {
          class: 'll-banner__close',
          type: 'button',
          'aria-label': 'Dismiss',
          onClick: () => {
            el.remove();
            opts.onDismiss?.();
          },
        },
        icon('x'),
      ),
  );
  return el;
}

/** Alias of {@link Banner}. */
export const Callout = Banner;

/* ========================================================================== */
/* List                                                                       */
/* ========================================================================== */

export interface ListOptions extends BaseOptions {
  /** `ListItem()` nodes. */
  items: Content;
  /** `plain` rows, `divided` rows with hairlines (default), `boxed` inside a bordered surface. */
  variant?: 'plain' | 'divided' | 'boxed';
  /** Accessible name for the list. */
  label?: string;
  /** Render an `<ol>` (numbered semantics). */
  ordered?: boolean;
}

/** A vertical list of rows: `List({ label: 'Faults', variant: 'boxed', items: faults.map(toListItem) })`. */
export function List(opts: ListOptions): HTMLElement {
  return h(
    opts.ordered ? 'ol' : 'ul',
    { ...opts.attrs, class: ['ll-list', `ll-list--${opts.variant ?? 'divided'}`, opts.class], 'aria-label': opts.label },
    opts.items,
  );
}

export interface ListItemOptions extends BaseOptions {
  title: Content;
  description?: Content;
  /** Leading icon in a tinted tile. */
  icon?: IconName;
  /** Custom leading node instead of an icon (sign art, a number, a flag emoji…). */
  leading?: Node;
  /** Tints the icon tile. */
  tone?: ToneOrAccent;
  /** Trailing slot: Chip, value text, a Toggle… (must not be interactive when `onClick`/`href` is set). */
  trailing?: Content;
  /** Makes the row a button. */
  onClick?: (event: MouseEvent) => void;
  /** Makes the row a link. */
  href?: string;
  /** Marks the current item (`aria-current`). */
  current?: boolean;
  disabled?: boolean;
  /** Trailing chevron for clickable rows (default true when clickable and no `trailing`). */
  chevron?: boolean;
}

/**
 * One row of a `List`: leading icon, title, description and a trailing slot.
 *
 * ```ts
 * ListItem({ icon: 'stop-sign', tone: 'bad', title: 'Rolling stop', description: fault.tip, trailing: SeverityChip('serious') })
 * ListItem({ icon: 'globe', title: 'Region', trailing: 'California', onClick: openRegionPicker })
 * ```
 */
export function ListItem(opts: ListItemOptions): HTMLLIElement {
  const clickable = Boolean(opts.onClick || opts.href);
  const showChevron = opts.chevron ?? clickable;
  const leading = opts.leading
    ? h('span', { class: 'll-list__leading' }, opts.leading)
    : opts.icon
      ? h('span', { class: 'll-list__leading' }, h('span', { class: 'll-icon-tile ll-icon-tile--sm', 'data-tone': opts.tone ?? 'neutral' }, icon(opts.icon)))
      : null;
  const children: Child[] = [
    leading,
    h(
      'span',
      { class: 'll-list__text' },
      h('span', { class: 'll-list__title' }, opts.title),
      opts.description && h('span', { class: 'll-list__description' }, opts.description),
    ),
    opts.trailing !== undefined && opts.trailing !== null && opts.trailing !== false
      ? h('span', { class: 'll-list__trailing' }, opts.trailing)
      : null,
    showChevron && icon('chevron-right', { class: 'll-list__chevron' }),
  ];
  const rowClass = ['ll-list__row', { 'll-list__row--action': clickable, 'is-current': Boolean(opts.current) }];
  const current = opts.current ? 'true' : undefined;
  const row = opts.href
    ? h('a', { class: rowClass, href: opts.href, 'aria-current': current }, children)
    : opts.onClick
      ? h('button', { class: rowClass, type: 'button', disabled: opts.disabled, 'aria-current': current, onClick: opts.onClick }, children)
      : h('div', { class: rowClass, 'aria-current': current }, children);
  return h('li', { ...opts.attrs, class: ['ll-list__item', opts.class] }, row);
}

/* ========================================================================== */
/* PageHeader                                                                 */
/* ========================================================================== */

export interface PageHeaderOptions extends BaseOptions {
  title: string;
  subtitle?: Content;
  /** Micro label above the title ("LESSON 3 OF 12"). */
  eyebrow?: string;
  /** Shows a back button that calls this (usually `() => screens.back()`). */
  onBack?: () => void;
  /** Accessible name / tooltip of the back button. Default "Back". */
  backLabel?: string;
  /** Right-hand slot for buttons. */
  actions?: Content;
  /** Heading level of the title (default 1 — one per screen). */
  level?: 1 | 2;
  /** Draw the dashed centre-line divider under the header. */
  divider?: boolean;
}

/**
 * Title block for a screen. The heading gets `tabindex="-1"` so the screen
 * manager can move focus to it when the screen appears.
 *
 * ```ts
 * PageHeader({ title: 'Skill practice', subtitle: 'Pick a manoeuvre to drill.', onBack: () => screens.back(),
 *              actions: Button({ label: 'Settings', icon: 'settings' }) })
 * ```
 */
export function PageHeader(opts: PageHeaderOptions): HTMLElement {
  const heading = h(`h${opts.level ?? 1}`, { class: 'll-page-header__title', tabIndex: -1 }, opts.title);
  const back = opts.onBack
    ? h(
        'button',
        {
          class: 'll-btn ll-icon-btn ll-btn--secondary ll-btn--md ll-page-header__back',
          type: 'button',
          'aria-label': opts.backLabel ?? 'Back',
          onClick: () => opts.onBack?.(),
        },
        icon('arrow-left', { class: 'll-btn__icon' }),
      )
    : null;
  return h(
    'header',
    { ...opts.attrs, class: ['ll-page-header', { 'll-page-header--divided': Boolean(opts.divider) }, opts.class] },
    back,
    h(
      'div',
      { class: 'll-page-header__text' },
      opts.eyebrow && h('p', { class: 'll-eyebrow ll-eyebrow--accent' }, opts.eyebrow),
      heading,
      opts.subtitle && h('p', { class: 'll-page-header__subtitle' }, opts.subtitle),
    ),
    opts.actions && h('div', { class: 'll-page-header__actions' }, opts.actions),
  );
}

/** Re-exported for convenience so callers can swap a row's content: `mount(el, …)`. */
export { mount };
