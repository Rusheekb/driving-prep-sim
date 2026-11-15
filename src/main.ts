import './ui/styles/index.css';
import { createGame } from './app/game';
import { createSettingsStore } from './app/settings';
import { getJurisdiction } from './jurisdictions';
import { installFavicon } from './ui/brand';

const root = document.getElementById('app')!;
installFavicon();
const settings = createSettingsStore();
const params = new URLSearchParams(location.search);
const profile = getJurisdiction(params.get('profile') ?? settings.get().jurisdictionId);

const game = createGame(root, settings, {
  onEnd: () => game.idle(profile),
  onPause: () => undefined,
});
game.start('free-drive', profile, {
  ...settings.get().session,
  weather: (params.get('weather') as 'clear' | 'rain' | 'fog' | null) ?? 'clear',
  timeOfDay: (params.get('time') as 'day' | 'dusk' | 'night' | null) ?? 'day',
});
// Handy for automated checks and debugging.
(window as unknown as { __game: unknown }).__game = game;
