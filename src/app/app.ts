/**
 * Top-level app: owns settings, progress and the game, and routes between the
 * menu screens that sit over the 3D town.
 */
import type { AppSettings, JurisdictionProfile, ScenarioCategory, ScenarioMeta, SessionResult, SessionSettings, SpeedUnit } from '../core/types';
import { getJurisdiction } from '../jurisdictions';
import { getScenario, listScenarios } from '../scenarios/defs';
import type { QuizMode } from '../theory/engine';
import { installFavicon } from '../ui/brand';
import { announce, applyUiPrefs, h } from '../ui/dom';
import { btn, modal } from '../ui/kit';
import { type Game, createGame } from './game';
import { type ProgressStore, createProgressStore } from './progress';
import { type Store, createSettingsStore } from './settings';

export type Route =
  | { name: 'home' }
  | { name: 'welcome' }
  | { name: 'region' }
  | { name: 'scenarios'; category: ScenarioCategory }
  | { name: 'briefing'; scenarioId: string }
  | { name: 'settings' }
  | { name: 'controls' }
  | { name: 'about' }
  | { name: 'results'; result: SessionResult }
  | { name: 'progress' }
  | { name: 'rules' }
  | { name: 'signs' }
  | { name: 'theory' }
  | { name: 'quiz'; mode: QuizMode };

export interface App {
  readonly settings: Store<AppSettings>;
  readonly progress: ProgressStore;
  profile(): JurisdictionProfile;
  /** Display unit after the user's override. */
  unit(): SpeedUnit;
  scenarios(): ScenarioMeta[];
  go(route: Route, replace?: boolean): void;
  back(): void;
  home(): void;
  /** Leave the menus and drive. `demo` lets the instructor drive instead. */
  startScenario(id: string, overrides?: Partial<SessionSettings>, demo?: boolean): void;
  device(): 'keyboard' | 'gamepad' | 'touch';
}

export type ScreenFactory<R extends Route = Route> = (app: App, route: R) => HTMLElement;
export type ScreenTable = { [K in Route['name']]: ScreenFactory<Extract<Route, { name: K }>> };

export function createApp(root: HTMLElement, screens: ScreenTable): App {
  installFavicon();
  root.classList.add('ll-app');
  const settings = createSettingsStore();
  const progress = createProgressStore();
  const applyPrefs = (s: AppSettings): void => applyUiPrefs({ highContrast: s.highContrast, reducedMotion: s.reducedMotion, textScale: s.textScale });
  applyPrefs(settings.get());

  const stack: Route[] = [];
  let pauseModal: { close(): void } | null = null;
  let lastRun: { id: string; overrides: Partial<SessionSettings> | undefined; demo: boolean } | null = null;

  const game: Game = createGame(root, settings, {
    onEnd(result, demo) {
      showMenus();
      if (demo) {
        game.idle(app.profile());
        render();
        return;
      }
      progress.recordSession(result);
      game.idle(app.profile());
      stack.length = 0;
      stack.push({ name: 'home' }, { name: 'results', result });
      render();
    },
    onPause() {
      if (pauseModal || !game.isDriving()) return;
      openPause();
    },
  });

  const screenRoot = h('div', { class: 'll-screens' });
  root.append(screenRoot);

  function showMenus(): void {
    screenRoot.hidden = false;
  }

  function render(): void {
    const route = stack[stack.length - 1] ?? { name: 'home' as const };
    const factory = screens[route.name] as ScreenFactory;
    screenRoot.textContent = '';
    const el = factory(app, route);
    screenRoot.append(el);
    const title = el.querySelector<HTMLElement>('h1');
    document.title = `${title?.textContent ?? 'Learner Lane'} · Learner Lane`;
    title?.focus({ preventScroll: true });
    if (title?.textContent) announce(title.textContent);
  }

  function openPause(): void {
    game.setPaused(true);
    const s = game.session;
    const close = (): void => {
      pauseModal?.close();
      pauseModal = null;
    };
    const resume = (): void => {
      close();
      game.setPaused(false);
    };
    pauseModal = modal({
      title: game.isDemo() ? 'Demo paused' : 'Paused',
      body: [h('p', null, s ? s.scenario.meta.title : ''), h('p', null, 'Press Esc to carry on. Controls: Settings → Controls on the main menu.')],
      actions: [
        btn('Quit', {
          variant: 'ghost',
          onClick: () => {
            close();
            const demo = game.isDemo();
            const result = game.abort();
            showMenus();
            game.idle(app.profile());
            if (result && !demo && (result.faults.length > 0 || result.distanceM > 60)) {
              progress.recordSession(result);
              stack.length = 0;
              stack.push({ name: 'home' }, { name: 'results', result });
            }
            render();
          },
        }),
        btn('Restart', {
          onClick: () => {
            close();
            game.abort();
            if (lastRun) app.startScenario(lastRun.id, lastRun.overrides, lastRun.demo);
          },
        }),
        btn('Resume', { variant: 'primary', icon: 'play', onClick: resume }),
      ],
      onClose: resume,
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || game.isDriving() || document.querySelector('.ll-modal')) return;
    if (stack.length > 1) {
      e.preventDefault();
      app.back();
    }
  });

  const app: App = {
    settings,
    progress,
    profile: () => getJurisdiction(settings.get().jurisdictionId),
    unit: () => {
      const u = settings.get().speedUnit;
      return u === 'auto' ? app.profile().speedUnit : u;
    },
    scenarios: () => listScenarios(app.profile()),
    go(route, replace = false) {
      if (replace) stack.pop();
      stack.push(route);
      render();
    },
    back() {
      if (stack.length > 1) stack.pop();
      render();
    },
    home() {
      stack.length = 0;
      stack.push({ name: 'home' });
      render();
    },
    startScenario(id, overrides, demo = false) {
      const def = getScenario(id);
      if (!def) return;
      lastRun = { id, overrides, demo };
      const s = settings.get();
      const session: SessionSettings = { ...s.session, ...def.meta.defaults, ...overrides, ...def.meta.forced, seed: Math.floor(Math.random() * 1e9) };
      screenRoot.hidden = true;
      game.start(id, app.profile(), demo ? { ...session, feedback: 'coach' } : session, { demo });
    },
    device: () => game.input.lastDevice(),
  };

  let lastProfile = settings.get().jurisdictionId;
  settings.subscribe((s) => {
    applyPrefs(s);
    if (s.jurisdictionId !== lastProfile) {
      lastProfile = s.jurisdictionId;
      if (!game.isDriving()) game.idle(app.profile());
    }
  });

  game.idle(app.profile());
  stack.push({ name: 'home' });
  if (!settings.get().onboarded) stack.push({ name: 'welcome' });
  render();
  // Handy for automated checks and debugging.
  (window as unknown as { __game: Game; __app: App }).__game = game;
  (window as unknown as { __app: App }).__app = app;
  return app;
}
