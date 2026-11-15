/**
 * Buttons: Button, LinkButton, IconButton.
 */
import { h, mount } from '../dom';
import { icon } from '../icons';
import type { IconName } from '../icons';
import type { BaseOptions, Content, Size } from './shared';
import { KeyCap } from './display';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonOptions extends BaseOptions {
  /** Button text (or any content). */
  label: Content;
  /**
   * - `primary`   the one main action on a screen (lane-yellow)
   * - `secondary` ordinary actions (default)
   * - `ghost`     low-emphasis / toolbar actions
   * - `danger`    destructive actions (reset progress, quit test)
   */
  variant?: ButtonVariant;
  /** `sm` 36 px, `md` 44 px (default), `lg` 56 px tall. Small buttons still have a 44 px hit area. */
  size?: Size;
  /** Leading icon. */
  icon?: IconName;
  /** Trailing icon (e.g. `arrow-right` on "Continue"). */
  iconEnd?: IconName;
  /** Show a spinner and ignore clicks; the button stays focusable and reports `aria-busy`. */
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the full width of the container. */
  block?: boolean;
  type?: 'button' | 'submit';
  /** Keyboard shortcut to show as a key cap inside the button, e.g. `'Enter'` (display only — bind the key yourself). */
  shortcut?: string;
  onClick?: (event: MouseEvent) => void;
}

export type ButtonElement = HTMLButtonElement & {
  setLoading(loading: boolean): void;
  setDisabled(disabled: boolean): void;
  setLabel(label: Content): void;
};

function buttonClasses(variant: ButtonVariant, size: Size, block: boolean | undefined): string[] {
  return ['ll-btn', `ll-btn--${variant}`, `ll-btn--${size}`, block ? 'll-btn--block' : ''];
}

/**
 * A push button.
 *
 * ```ts
 * Button({ label: 'Start lesson', variant: 'primary', size: 'lg', icon: 'play', onClick: start })
 * const save = Button({ label: 'Save' }); save.setLoading(true);
 * ```
 */
export function Button(opts: ButtonOptions): ButtonElement {
  const variant = opts.variant ?? 'secondary';
  const size = opts.size ?? 'md';
  const labelEl = h('span', { class: 'll-btn__label' }, opts.label);
  const spinner = h('span', { class: 'll-btn__spinner', 'aria-hidden': true }, h('span', { class: 'll-spinner' }));

  const el = h(
    'button',
    {
      ...opts.attrs,
      class: [buttonClasses(variant, size, opts.block), opts.class],
      type: opts.type ?? 'button',
      disabled: opts.disabled,
      'aria-keyshortcuts': opts.shortcut,
      onClick: (event) => {
        if (el.getAttribute('aria-disabled') === 'true') {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        opts.onClick?.(event);
      },
    },
    opts.icon && icon(opts.icon, { class: 'll-btn__icon' }),
    labelEl,
    opts.iconEnd && icon(opts.iconEnd, { class: 'll-btn__icon ll-btn__icon--end' }),
    opts.shortcut && KeyCap(opts.shortcut, { class: 'll-btn__kbd' }),
    spinner,
  ) as ButtonElement;

  el.setLoading = (loading) => {
    el.classList.toggle('is-loading', loading);
    if (loading) {
      el.setAttribute('aria-busy', 'true');
      el.setAttribute('aria-disabled', 'true');
    } else {
      el.removeAttribute('aria-busy');
      el.removeAttribute('aria-disabled');
    }
  };
  el.setDisabled = (disabled) => {
    el.disabled = disabled;
  };
  el.setLabel = (label) => {
    mount(labelEl, label);
  };
  if (opts.loading) el.setLoading(true);
  return el;
}

export interface LinkButtonOptions extends BaseOptions {
  label: Content;
  href: string;
  variant?: ButtonVariant;
  size?: Size;
  icon?: IconName;
  iconEnd?: IconName;
  block?: boolean;
  /** Open in a new tab (adds `rel="noopener noreferrer"`, an external-link icon and a screen-reader hint). */
  external?: boolean;
}

/** A link that looks like a button — for navigation to another page (e.g. the official handbook). */
export function LinkButton(opts: LinkButtonOptions): HTMLAnchorElement {
  const iconEnd = opts.iconEnd ?? (opts.external ? 'external-link' : undefined);
  return h(
    'a',
    {
      ...opts.attrs,
      class: [buttonClasses(opts.variant ?? 'secondary', opts.size ?? 'md', opts.block), opts.class],
      href: opts.href,
      target: opts.external ? '_blank' : undefined,
      rel: opts.external ? 'noopener noreferrer' : undefined,
    },
    opts.icon && icon(opts.icon, { class: 'll-btn__icon' }),
    h('span', { class: 'll-btn__label' }, opts.label),
    opts.external && h('span', { class: 'll-sr-only' }, ' (opens in a new tab)'),
    iconEnd && icon(iconEnd, { class: 'll-btn__icon ll-btn__icon--end' }),
  );
}

export interface IconButtonOptions extends BaseOptions {
  icon: IconName;
  /** Accessible name (required) — also shown as a tooltip. */
  label: string;
  variant?: ButtonVariant;
  size?: Size;
  disabled?: boolean;
  /** Makes it a toggle button: sets `aria-pressed`. */
  pressed?: boolean;
  /** Tooltip placement, or `false` for none (default `'top'`). */
  tooltip?: 'top' | 'bottom' | 'left' | 'right' | false;
  onClick?: (event: MouseEvent) => void;
}

export type IconButtonElement = HTMLButtonElement & {
  setIcon(name: IconName): void;
  setLabel(label: string): void;
  setPressed(pressed: boolean): void;
};

/**
 * A square button showing only an icon. The label is mandatory: it is the
 * accessible name and the hover/focus tooltip.
 *
 * ```ts
 * IconButton({ icon: 'pause', label: 'Pause', onClick: pause })
 * const mute = IconButton({ icon: 'volume', label: 'Mute', pressed: false });
 * mute.setPressed(true); mute.setIcon('volume-off');
 * ```
 */
export function IconButton(opts: IconButtonOptions): IconButtonElement {
  const tooltip = opts.tooltip ?? 'top';
  const el = h(
    'button',
    {
      ...opts.attrs,
      class: ['ll-btn', 'll-icon-btn', `ll-btn--${opts.variant ?? 'ghost'}`, `ll-btn--${opts.size ?? 'md'}`, opts.class],
      type: 'button',
      disabled: opts.disabled,
      'aria-label': opts.label,
      'aria-pressed': opts.pressed,
      'data-tooltip': tooltip ? opts.label : undefined,
      'data-tooltip-pos': tooltip || undefined,
      onClick: opts.onClick,
    },
    icon(opts.icon, { class: 'll-btn__icon' }),
  ) as IconButtonElement;

  el.setIcon = (name) => {
    mount(el, icon(name, { class: 'll-btn__icon' }));
  };
  el.setLabel = (label) => {
    el.setAttribute('aria-label', label);
    if (el.hasAttribute('data-tooltip')) el.setAttribute('data-tooltip', label);
  };
  el.setPressed = (pressed) => {
    el.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  };
  return el;
}
