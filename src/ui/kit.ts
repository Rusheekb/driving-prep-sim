/**
 * Small accessible building blocks for the menus, built on the design tokens.
 * Every control is a real button/input so keyboard and screen readers work.
 */
import { type Child, h, uid } from './dom';
import { type IconName, icon } from './icons';

export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'bad' | 'accent';

export interface ButtonOptions {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  disabled?: boolean;
  onClick(): void;
}

export function btn(label: string, o: ButtonOptions): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: ['ll-btn', `ll-btn--${o.variant ?? 'secondary'}`, `ll-btn--${o.size ?? 'md'}`], title: o.title, disabled: o.disabled, onClick: () => o.onClick() },
    o.icon ? icon(o.icon, { size: o.size === 'lg' ? 22 : 18 }) : null,
    h('span', null, label),
  );
}

export const chip = (text: string, tone: Tone = 'neutral', iconName?: IconName): HTMLElement =>
  h('span', { class: ['ll-chip', `ll-chip--${tone}`] }, iconName ? icon(iconName, { size: 14 }) : null, text);

export function stars(n: number, max = 3): HTMLElement {
  const el = h('span', { class: 'll-stars', role: 'img', 'aria-label': `${n} of ${max} stars` });
  for (let i = 0; i < max; i++) el.append(icon(i < n ? 'star-filled' : 'star', { size: 18, class: i < n ? 'll-stars__on' : 'll-stars__off' }));
  return el;
}

export interface CardOptions {
  title: string;
  text?: string;
  icon?: IconName;
  media?: Child;
  badge?: Child;
  footer?: Child;
  tone?: Tone;
  onClick?(): void;
  highlight?: boolean;
}

/** A card; clickable cards are buttons. */
export function card(o: CardOptions): HTMLElement {
  const body: Child[] = [
    o.media ?? (o.icon ? h('span', { class: 'll-card__icon' }, icon(o.icon, { size: 26 })) : null),
    h('span', { class: 'll-card__body' }, h('span', { class: 'll-card__title' }, o.title, o.badge ? h('span', { class: 'll-card__badge' }, o.badge) : null), o.text ? h('span', { class: 'll-card__text' }, o.text) : null, o.footer ? h('span', { class: 'll-card__footer' }, o.footer) : null),
  ];
  const cls = ['ll-card', o.onClick ? 'll-card--action' : '', o.highlight ? 'll-card--highlight' : '', o.tone ? `ll-card--${o.tone}` : ''];
  return o.onClick ? h('button', { type: 'button', class: cls, onClick: () => o.onClick!() }, ...body) : h('div', { class: cls }, ...body);
}

/** Radio-group style segmented control. */
export function seg<T extends string>(label: string, options: { value: T; label: string; hint?: string }[], value: T, onChange: (v: T) => void, disabled = false): HTMLElement {
  const name = uid('seg');
  const group = h('div', { class: 'll-seg', role: 'radiogroup', 'aria-label': label });
  const hint = h('div', { class: 'll-field__hint' }, options.find((o) => o.value === value)?.hint ?? '');
  for (const o of options) {
    const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === value, disabled, class: 'll-seg__input', id: `${name}-${o.value}` }) as HTMLInputElement;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      hint.textContent = o.hint ?? '';
      onChange(o.value);
    });
    group.append(input, h('label', { for: `${name}-${o.value}`, class: 'll-seg__label' }, o.label));
  }
  return h('div', { class: ['ll-field', disabled ? 'is-disabled' : ''] }, h('div', { class: 'll-field__label' }, label, disabled ? chip('set by this lesson', 'neutral', 'lock') : null), group, hint);
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void, hint?: string): HTMLElement {
  const id = uid('tog');
  const input = h('input', { type: 'checkbox', role: 'switch', id, checked: value, class: 'll-toggle__input' }) as HTMLInputElement;
  input.addEventListener('change', () => onChange(input.checked));
  return h('div', { class: 'll-field ll-field--row' }, h('label', { for: id, class: 'll-field__label' }, label, hint ? h('span', { class: 'll-field__hint' }, hint) : null), h('span', { class: 'll-toggle' }, input, h('span', { class: 'll-toggle__track', 'aria-hidden': 'true' })));
}

export function slider(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, format: (v: number) => string = String): HTMLElement {
  const id = uid('sl');
  const out = h('output', { class: 'll-field__value', for: id }, format(value));
  const input = h('input', { type: 'range', id, min, max, step, value, class: 'll-slider' }) as HTMLInputElement;
  input.addEventListener('input', () => {
    out.textContent = format(Number(input.value));
    onChange(Number(input.value));
  });
  return h('div', { class: 'll-field' }, h('label', { for: id, class: 'll-field__label' }, label, out), input);
}

export const section = (title: string, ...children: Child[]): HTMLElement => h('section', { class: 'll-section' }, h('h2', { class: 'll-section__title' }, title), ...children);

export const stat = (value: string, label: string, iconName?: IconName, tone: Tone = 'neutral'): HTMLElement =>
  h('div', { class: ['ll-stat', `ll-stat--${tone}`] }, iconName ? icon(iconName, { size: 20 }) : null, h('div', { class: 'll-stat__value' }, value), h('div', { class: 'll-stat__label' }, label));

export const callout = (tone: Tone, iconName: IconName, ...children: Child[]): HTMLElement => h('div', { class: ['ll-callout', `ll-callout--${tone}`] }, icon(iconName, { size: 20 }), h('div', null, ...children));

export function progressBar(value: number, max: number, tone: Tone = 'accent'): HTMLElement {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return h('div', { class: ['ll-bar', `ll-bar--${tone}`], role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': value }, h('div', { class: 'll-bar__fill', style: { width: `${pct}%` } }));
}

/** Circular meter (0..1). */
export function ring(value: number, label: string, size = 96): HTMLElement {
  const r = 42;
  const c = 2 * Math.PI * r;
  const el = h('div', { class: 'll-ring', style: { width: `${size}px`, height: `${size}px` }, role: 'img', 'aria-label': `${label}: ${Math.round(value * 100)} percent` });
  el.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" class="ll-ring__track"/><circle cx="50" cy="50" r="${r}" class="ll-ring__fill" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0, Math.min(1, value)))}" transform="rotate(-90 50 50)"/></svg><div class="ll-ring__text"><b>${Math.round(value * 100)}%</b><span>${label}</span></div>`;
  return el;
}

/* -------------------------------- dialogs --------------------------------- */

export interface ModalHandle {
  close(): void;
  element: HTMLElement;
}

/** Modal dialog with a focus trap; Esc and the backdrop close it when `onClose` is given. */
export function modal(o: { title: string; body: Child[]; actions?: Child[]; onClose?(): void; wide?: boolean }): ModalHandle {
  const previous = document.activeElement as HTMLElement | null;
  const titleId = uid('dlg');
  const panel = h('div', { class: ['ll-modal__panel', o.wide ? 'll-modal__panel--wide' : ''], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabIndex: -1 }, h('h2', { id: titleId, class: 'll-modal__title' }, o.title), h('div', { class: 'll-modal__body' }, ...o.body), o.actions ? h('div', { class: 'll-modal__actions' }, ...o.actions) : null);
  const root = h('div', { class: 'll-modal' }, panel);
  const close = (): void => {
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    previous?.focus?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && o.onClose) {
      e.stopPropagation();
      e.preventDefault();
      o.onClose();
    } else if (e.key === 'Tab') {
      const items = [...panel.querySelectorAll<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root && o.onClose) o.onClose();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  (panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>('button') ?? panel).focus();
  return { close, element: root };
}

export function confirmDialog(title: string, text: string, yes = 'Yes', no = 'Cancel', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean): void => {
      m.close();
      resolve(v);
    };
    const m = modal({ title, body: [h('p', null, text)], actions: [btn(no, { variant: 'ghost', onClick: () => done(false) }), btn(yes, { variant: danger ? 'danger' : 'primary', onClick: () => done(true) })], onClose: () => done(false) });
  });
}

let toastRoot: HTMLElement | null = null;
export function toast(text: string, tone: Tone = 'neutral'): void {
  if (!toastRoot) {
    toastRoot = h('div', { class: 'll-toasts', 'aria-live': 'polite' });
    document.body.append(toastRoot);
  }
  const t = h('div', { class: ['ll-toast', `ll-toast--${tone}`] }, text);
  toastRoot.append(t);
  window.setTimeout(() => t.remove(), 3200);
}

/* --------------------------------- pages ---------------------------------- */

export interface PageOptions {
  title: string;
  subtitle?: string;
  /** Show a back button. */
  onBack?(): void;
  actions?: Child[];
  /** Narrow reading column. */
  narrow?: boolean;
}

/** A full-screen menu page laid over the 3D town. */
export function page(o: PageOptions, ...children: Child[]): HTMLElement {
  return h(
    'div',
    { class: 'll-page' },
    h(
      'div',
      { class: ['ll-page__inner', o.narrow ? 'll-page__inner--narrow' : ''] },
      h(
        'header',
        { class: 'll-page__header' },
        o.onBack ? h('button', { type: 'button', class: 'll-btn ll-btn--ghost ll-btn--md ll-page__back', onClick: () => o.onBack!(), 'aria-label': 'Back' }, icon('arrow-left', { size: 18 }), h('span', null, 'Back')) : null,
        h('div', { class: 'll-page__titles' }, h('h1', { class: 'll-page__title', tabIndex: -1 }, o.title), o.subtitle ? h('p', { class: 'll-page__subtitle' }, o.subtitle) : null),
        o.actions ? h('div', { class: 'll-page__actions' }, ...o.actions) : null,
      ),
      ...children,
    ),
  );
}
