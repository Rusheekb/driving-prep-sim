/**
 * Learner Lane — tiny DOM toolkit.
 *
 * `h()` is a typed hyperscript helper that returns real DOM nodes; the whole UI
 * (components, screens, HUD) is built with it — there is no framework and no
 * virtual DOM. State lives in closures or in a `createStore()`.
 *
 * ```ts
 * const btn = h('button', { class: ['ll-btn', { 'll-btn--primary': primary }], onClick: start }, 'Start');
 * mount(root, h('div', { class: 'll-stack' }, h('h1', null, 'Hello'), btn));
 * ```
 *
 * Nothing in this file touches `document` at import time, so the pure helpers
 * (`cx`, `createStore`, `clamp`…) can be unit-tested in node.
 */

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

/** Anything `h()` accepts as a child. `null`, `undefined` and `false` render nothing. */
export type Child = Node | string | number | null | undefined | false | readonly Child[];

/** Class names: a string, a list (falsy entries are skipped) or a `{ name: enabled }` record. */
export type ClassValue =
  | string
  | null
  | undefined
  | false
  | readonly ClassValue[]
  | { readonly [className: string]: boolean | null | undefined };

/** Inline style: CSS text, or an object of camelCase properties and `--custom-properties`. */
export type StyleValue =
  | string
  | ({ [P in keyof CSSStyleDeclaration]?: CSSStyleDeclaration[P] extends string ? string | number : never } & {
      [customProperty: `--${string}`]: string | number | null | undefined;
    });

export type AttrValue = string | number | boolean | null | undefined;

type Handler<E extends Event, T extends Element> = (event: E & { currentTarget: T }) => void;

/** `onClick`, `onKeydown`, `onPointerdown`, … — one prop per DOM event (`on` + capitalised event name). */
type NativeEventProps<T extends Element> = {
  [K in keyof HTMLElementEventMap as `on${Capitalize<K>}`]?: Handler<HTMLElementEventMap[K], T>;
};

/** Familiar camelCase spellings for the events used most (`onKeyDown` === `onKeydown`). */
interface CamelEventProps<T extends Element> {
  onKeyDown?: Handler<KeyboardEvent, T>;
  onKeyUp?: Handler<KeyboardEvent, T>;
  onPointerDown?: Handler<PointerEvent, T>;
  onPointerUp?: Handler<PointerEvent, T>;
  onPointerMove?: Handler<PointerEvent, T>;
  onPointerEnter?: Handler<PointerEvent, T>;
  onPointerLeave?: Handler<PointerEvent, T>;
  onPointerCancel?: Handler<PointerEvent, T>;
  onMouseEnter?: Handler<MouseEvent, T>;
  onMouseLeave?: Handler<MouseEvent, T>;
  onMouseDown?: Handler<MouseEvent, T>;
  onMouseUp?: Handler<MouseEvent, T>;
  onDblClick?: Handler<MouseEvent, T>;
  onContextMenu?: Handler<MouseEvent, T>;
  onFocusIn?: Handler<FocusEvent, T>;
  onFocusOut?: Handler<FocusEvent, T>;
  onTouchStart?: Handler<TouchEvent, T>;
  onTouchEnd?: Handler<TouchEvent, T>;
  onTouchMove?: Handler<TouchEvent, T>;
  onTransitionEnd?: Handler<TransitionEvent, T>;
  onAnimationEnd?: Handler<AnimationEvent, T>;
}

/**
 * Props accepted by `h()`.
 *
 * - `class` / `style` / `dataset` — see {@link ClassValue}, {@link StyleValue}.
 * - `on*` — event listeners (`onClick` → `'click'`; the name is lower-cased).
 * - `ref` — called with the element once it has been created and populated.
 * - `value`, `checked`, `selected`, `indeterminate`, `textContent` — set as DOM **properties**.
 * - everything else is an **attribute**: strings/numbers are stringified,
 *   `true` writes an empty attribute (`disabled`, `hidden`…), and
 *   `false` / `null` / `undefined` omit it. `aria-*` attributes are the
 *   exception: booleans are written as `"true"` / `"false"`, as ARIA requires.
 *   `htmlFor` and `className` are accepted as aliases of `for` and `class`.
 */
export type Props<T extends Element = HTMLElement> = NativeEventProps<T> &
  CamelEventProps<T> & {
    class?: ClassValue;
    className?: ClassValue;
    style?: StyleValue;
    dataset?: Record<string, AttrValue>;
    ref?: (element: T) => void;
    id?: string;
    title?: string;
    role?: string;
    hidden?: boolean;
    tabIndex?: number;
    disabled?: boolean;
    type?: string;
    name?: string;
    value?: string | number;
    checked?: boolean;
    href?: string;
    for?: string;
    htmlFor?: string;
    textContent?: string;
    /** Any other attribute (`aria-*`, `data-*`, `min`, `placeholder`, …). */
    [attribute: string]: unknown;
  };

/* ========================================================================== */
/* Pure helpers                                                               */
/* ========================================================================== */

/**
 * Join class names. Accepts strings, nested arrays and `{ name: enabled }`
 * records; falsy values are skipped.
 *
 * `cx('ll-btn', ['a', false], { 'is-on': true, 'is-off': false })` → `'ll-btn a is-on'`
 */
export function cx(...values: ClassValue[]): string {
  const out: string[] = [];
  const walk = (value: ClassValue): void => {
    if (!value) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) out.push(trimmed);
    } else if (Array.isArray(value)) {
      for (const item of value as readonly ClassValue[]) walk(item);
    } else {
      const record = value as { readonly [className: string]: boolean | null | undefined };
      for (const key of Object.keys(record)) if (record[key]) out.push(key);
    }
  };
  for (const value of values) walk(value);
  return out.join(' ');
}

/** Clamp `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

let uidCounter = 0;
/** Document-unique id for wiring `for` / `aria-labelledby` / `aria-controls`. */
export function uid(prefix = 'll'): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter.toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

export interface Store<T> {
  /** Current value. */
  get(): T;
  /** Replace the value (or derive it from the previous one) and notify subscribers if it changed (`Object.is`). */
  set(next: T | ((previous: T) => T)): void;
  /**
   * Call `listener(value, previous)` after every change. Pass `{ immediate: true }`
   * to also call it right away with the current value. Returns an unsubscribe function.
   */
  subscribe(listener: (value: T, previous: T) => void, opts?: { immediate?: boolean }): () => void;
}

/**
 * Minimal observable value — enough reactivity for menus and the HUD.
 *
 * ```ts
 * const volume = createStore(0.8);
 * const off = volume.subscribe((v) => (label.textContent = `${Math.round(v * 100)}%`), { immediate: true });
 * volume.set(0.5);            // label updates
 * volume.set((v) => v + 0.1);
 * off();                       // stop listening
 * ```
 */
export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T, previous: T) => void>();
  return {
    get: () => value,
    set(next) {
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      const previous = value;
      value = resolved;
      for (const listener of [...listeners]) listener(value, previous);
    },
    subscribe(listener, opts) {
      listeners.add(listener);
      if (opts?.immediate) listener(value, value);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/* ========================================================================== */
/* Element creation                                                           */
/* ========================================================================== */

const PROPERTY_KEYS = new Set(['value', 'checked', 'selected', 'indeterminate', 'textContent']);

function applyStyle(el: HTMLElement | SVGElement, style: StyleValue): void {
  if (typeof style === 'string') {
    el.setAttribute('style', style);
    return;
  }
  const record = style as Record<string, string | number | null | undefined>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value === null || value === undefined) continue;
    if (key.startsWith('--')) el.style.setProperty(key, String(value));
    else (el.style as unknown as Record<string, string>)[key] = String(value);
  }
}

function applyProp(el: HTMLElement, key: string, value: unknown): void {
  if (key === 'class' || key === 'className') {
    const classes = cx(value as ClassValue);
    if (classes) el.setAttribute('class', el.className ? `${el.className} ${classes}` : classes);
    return;
  }
  if (key === 'style') {
    if (value) applyStyle(el, value as StyleValue);
    return;
  }
  if (key === 'dataset') {
    const data = (value ?? {}) as Record<string, AttrValue>;
    for (const name of Object.keys(data)) {
      const v = data[name];
      if (v === null || v === undefined || v === false) continue;
      el.dataset[name] = v === true ? '' : String(v);
    }
    return;
  }
  if (key === 'ref') return; // handled after children are appended
  if (key.length > 2 && key.startsWith('on') && typeof value === 'function') {
    el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    return;
  }
  if (PROPERTY_KEYS.has(key)) {
    if (value !== null && value !== undefined) (el as unknown as Record<string, unknown>)[key] = value;
    return;
  }
  const name = key === 'htmlFor' ? 'for' : key;
  if (value === null || value === undefined) return;
  if (typeof value === 'boolean') {
    if (name.startsWith('aria-')) el.setAttribute(name, value ? 'true' : 'false');
    else if (value) el.setAttribute(name, '');
    return;
  }
  el.setAttribute(name, String(value));
}

/** Append children (flattening arrays, skipping `null` / `undefined` / `false`). Returns `parent`. */
export function append<T extends ParentNode>(parent: T, ...children: Child[]): T {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      parent.append(String(child));
    } else if (child instanceof Node) {
      parent.append(child);
    } else {
      append(parent, ...(child as readonly Child[]));
    }
  }
  return parent;
}

/**
 * Create an HTML element.
 *
 * ```ts
 * h('button', { class: 'll-btn', type: 'button', 'aria-pressed': on, onClick: toggle }, icon('play'), 'Start');
 * h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: 0.5, onInput: (e) => set(e.currentTarget.valueAsNumber) });
 * h('ul', { class: 'll-list' }, items.map((item) => h('li', null, item.name)));
 * ```
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props<HTMLElementTagNameMap[K]> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    const record = props as Record<string, unknown>;
    for (const key of Object.keys(record)) applyProp(el, key, record[key]);
  }
  append(el, ...children);
  if (props?.ref) props.ref(el);
  return el;
}

/** A DocumentFragment holding `children` (useful to return several siblings). */
export function frag(...children: Child[]): DocumentFragment {
  return append(document.createDocumentFragment(), ...children);
}

/** A text node. */
export function text(value: string | number): Text {
  return document.createTextNode(String(value));
}

/**
 * Parse a **trusted** SVG markup string (icons, the logo, road-sign artwork from
 * `src/signs`) into an `SVGElement`. Never pass user input: the markup is
 * parsed as HTML.
 */
export function svg(markup: string): SVGElement {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  const el = template.content.firstElementChild;
  if (!(el instanceof SVGElement)) {
    throw new Error('svg(): markup must have a single <svg> root element');
  }
  return el;
}

/** Remove every child of `el`. Returns `el`. */
export function clear<T extends Element | DocumentFragment>(el: T): T {
  el.replaceChildren();
  return el;
}

/** Replace the contents of `parent` with `children`. Returns `parent`. */
export function mount<T extends Element>(parent: T, ...children: Child[]): T {
  parent.replaceChildren();
  return append(parent, ...children);
}

/* ========================================================================== */
/* Focus + preferences                                                        */
/* ========================================================================== */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Tabbable descendants of `root` in DOM order (skips hidden and inert subtrees). */
export function focusableWithin(root: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el.closest('[hidden], [inert]')) continue;
    if (el.getClientRects().length === 0) continue;
    out.push(el);
  }
  return out;
}

/** True when motion should be avoided: the OS preference or `<html data-reduced-motion="true">`. */
export function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.dataset.reducedMotion === 'true') return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface UiPrefs {
  /** `<html data-contrast="high">` */
  highContrast?: boolean;
  /** `<html data-reduced-motion="true">` */
  reducedMotion?: boolean;
  /** `--text-scale` on `<html>`, clamped to 0.85 – 1.4. */
  textScale?: number;
}

/**
 * Apply display preferences (normally from `AppSettings`) to `<html>`.
 * Only the keys present in `prefs` are changed.
 */
export function applyUiPrefs(prefs: UiPrefs): void {
  const root = document.documentElement;
  if (prefs.highContrast !== undefined) {
    if (prefs.highContrast) root.dataset.contrast = 'high';
    else delete root.dataset.contrast;
  }
  if (prefs.reducedMotion !== undefined) {
    if (prefs.reducedMotion) root.dataset.reducedMotion = 'true';
    else delete root.dataset.reducedMotion;
  }
  if (prefs.textScale !== undefined) {
    root.style.setProperty('--text-scale', String(clamp(prefs.textScale, 0.85, 1.4)));
  }
}

/* ========================================================================== */
/* Screen-reader announcements                                                */
/* ========================================================================== */

let liveHost: { polite: HTMLElement; assertive: HTMLElement } | null = null;

function ensureLiveRegions(): { polite: HTMLElement; assertive: HTMLElement } {
  if (liveHost && liveHost.polite.isConnected) return liveHost;
  const make = (politeness: 'polite' | 'assertive'): HTMLElement =>
    h('div', {
      class: 'll-sr-only',
      'aria-live': politeness,
      'aria-atomic': true,
      role: politeness === 'assertive' ? 'alert' : 'status',
      dataset: { llLive: politeness },
    });
  liveHost = { polite: make('polite'), assertive: make('assertive') };
  document.body.append(liveHost.polite, liveHost.assertive);
  return liveHost;
}

/**
 * Speak `message` to screen-reader users through a visually hidden live region.
 * Polite by default (waits for the current utterance); pass `assertive = true`
 * for things that cannot wait (a serious fault, the test ending).
 */
export function announce(message: string, assertive = false): void {
  if (typeof document === 'undefined' || !message) return;
  const region = ensureLiveRegions()[assertive ? 'assertive' : 'polite'];
  // Clearing first makes identical consecutive messages announce again.
  region.textContent = '';
  setTimeout(() => {
    region.textContent = message;
  }, 40);
}
