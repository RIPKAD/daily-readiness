import { isIsoDate, todayIso } from './dates';
import { state, type Route } from './state';
import { loadApiKey, loadDatabase, loadSettings } from './storage';
import { el } from './ui';
import { renderHistory } from './views/history';
import { renderSettings } from './views/settings';
import { renderToday } from './views/today';
import { renderWorkout } from './views/workout';

const ROUTES: Route[] = ['today', 'workout', 'history', 'settings'];

export async function boot(): Promise<void> {
  document.addEventListener('dr-render', () => render());
  window.addEventListener('hashchange', () => {
    readRoute();
    render();
  });
  try {
    const data = await loadDatabase();
    state.checkins = data.checkins;
    state.workouts = data.workouts;
    state.benchmarks = data.benchmarks;
    state.settings = loadSettings();
    state.apiKey = loadApiKey();
  } catch (error) {
    state.loadError = error instanceof Error ? error.message : 'The log on this phone could not be opened.';
  }
  state.ready = true;
  if (!location.hash) history.replaceState(null, '', '#today');
  readRoute();
  render();
}

function readRoute(): void {
  const raw = (location.hash.replace(/^#/, '') || 'today').split('?')[0];
  const [route, date] = raw.split('/');
  state.route = ROUTES.includes(route as Route) ? (route as Route) : 'today';
  if (date && isIsoDate(date)) state.date = date;
  else if (state.route === 'today' || state.route === 'workout') state.date = todayIso();
}

function render(): void {
  const app = document.querySelector('#app');
  if (!app) return;
  app.replaceChildren();
  const frame = el('div', 'frame');
  const main = el('main');
  main.id = 'main';
  frame.append(main);
  const toast = el('p', 'toast');
  toast.id = 'toast';
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  app.append(frame, renderNav(), toast);

  if (!state.ready) {
    main.append(el('p', 'lede', 'Opening your log…'));
    return;
  }
  if (state.loadError) main.append(el('p', 'form-error', state.loadError));
  if (state.route === 'today') renderToday(main);
  else if (state.route === 'workout') renderWorkout(main);
  else if (state.route === 'history') renderHistory(main);
  else renderSettings(main);
}

function renderNav(): HTMLElement {
  const nav = el('nav', 'nav');
  nav.setAttribute('aria-label', 'Primary');
  const items: { route: Route; label: string }[] = [
    { route: 'today', label: 'Today' },
    { route: 'workout', label: 'Workout' },
    { route: 'history', label: 'History' },
    { route: 'settings', label: 'Settings' },
  ];
  for (const item of items) {
    const link = el('a', '', item.label);
    link.href = `#${item.route}`;
    if (state.route === item.route) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  return nav;
}
