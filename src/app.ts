import { isIsoDate, todayIso } from './dates';
import { fetchRepoFoods, mergeFoods, sameFoodList } from './food';
import { state, type Route } from './state';
import { templatesOrSeed } from './strength';
import { loadApiKey, loadDatabase, loadSettings, persistDatabase } from './storage';
import { el } from './ui';
import { renderFood } from './views/food';
import { renderHistory } from './views/history';
import { renderSettings } from './views/settings';
import { renderStrength } from './views/strength';
import { renderToday } from './views/today';
import { renderWorkout } from './views/workout';

const ROUTES: Route[] = ['today', 'food', 'strength', 'workout', 'history', 'settings'];

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
    state.foods = data.foods;
    state.foodEntries = data.foodEntries;
    state.foodTargets = data.foodTargets;
    state.strengthSessions = data.strengthSessions;
    state.strengthTemplates = templatesOrSeed(data.strengthTemplates);
    state.hiddenFoodIds = [...new Set([
      ...data.hiddenFoodIds,
      ...data.foods.filter((food) => food.hidden).map((food) => food.id),
    ])];
    state.settings = loadSettings();
    state.apiKey = loadApiKey();
    try {
      const repo = await fetchRepoFoods();
      const merged = mergeFoods(state.foods, repo, new Date().toISOString(), state.hiddenFoodIds);
      if (!sameFoodList(state.foods, merged)) {
        state.foods = merged;
        await persistAll();
      }
    } catch {
      state.foodCatalogError = 'The shared food list did not load. Foods saved on this phone are still here.';
    }
    if (data.strengthTemplates.length !== state.strengthTemplates.length) await persistAll();
  } catch (error) {
    state.loadError = error instanceof Error ? error.message : 'The log on this phone could not be opened.';
  }
  state.ready = true;
  if (!location.hash) history.replaceState(null, '', '#food');
  readRoute();
  render();
}

function readRoute(): void {
  const raw = (location.hash.replace(/^#/, '') || 'today').split('?')[0];
  const [route, date] = raw.split('/');
  state.route = ROUTES.includes(route as Route) ? (route as Route) : 'today';
  if (date && isIsoDate(date)) state.date = date;
  else if (state.route === 'today' || state.route === 'food' || state.route === 'strength' || state.route === 'workout') state.date = todayIso();
}

function persistAll(): Promise<void> {
  return persistDatabase({
    checkins: state.checkins,
    workouts: state.workouts,
    benchmarks: state.benchmarks,
    foods: state.foods,
    foodEntries: state.foodEntries,
    foodTargets: state.foodTargets,
    strengthSessions: state.strengthSessions,
    strengthTemplates: state.strengthTemplates,
    hiddenFoodIds: state.hiddenFoodIds,
  });
}

function render(): void {
  const app = document.querySelector('#app');
  if (!app) return;
  app.replaceChildren();
  const frame = el('div', 'frame');
  const main = el('main');
  main.id = 'main';
  frame.append(main);
  const toast = el('div', 'toast');
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
  else if (state.route === 'food') renderFood(main);
  else if (state.route === 'strength') renderStrength(main);
  else if (state.route === 'workout') renderWorkout(main);
  else if (state.route === 'history') renderHistory(main);
  else renderSettings(main);
}

function renderNav(): HTMLElement {
  const nav = el('nav', 'nav');
  nav.setAttribute('aria-label', 'Primary');
  const items: { route: Route; label: string }[] = [
    { route: 'today', label: 'Today' },
    { route: 'food', label: 'Food' },
    { route: 'strength', label: 'Strength' },
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
