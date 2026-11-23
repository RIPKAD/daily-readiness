import { isIsoDate, todayIso } from '../dates';
import { macroShare, scaled, sortFoods, tally } from '../food';
import { state } from '../state';
import { persistDatabase } from '../storage';
import type { Food, FoodEntry, FoodTarget } from '../types';
import { button, el, field, showToast, uid } from '../ui';

let query = '';
let openFoodId: string | null = null;
let servingsText = '1';
let showQuick = false;
let showAdd = false;
let showManage = false;
let editingId: string | null = null;

export function renderFood(main: HTMLElement): void {
  const header = el('header', 'page-head');
  header.append(el('p', 'eyebrow', 'What you ate'));
  header.append(el('h1', 'title', 'Food'));
  main.append(header);

  const date = el('input');
  date.type = 'date';
  date.value = state.date;
  date.addEventListener('change', () => {
    if (!isIsoDate(date.value)) return;
    location.hash = `#food/${date.value}`;
  });
  main.append(field('Date', date, state.date === todayIso() ? 'Today' : 'A previous day'));

  if (state.foodCatalogError) main.append(el('p', 'form-error', state.foodCatalogError));

  const entries = state.foodEntries
    .filter((entry) => entry.date === state.date)
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt) || a.id.localeCompare(b.id));
  const total = tally(entries);
  const target = state.foodTargets.find((row) => row.date === state.date) ?? null;
  main.append(tallyCard(total, target));
  main.append(targetFields(target));

  main.append(el('h2', 'section-title', 'Add'));
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Search foods';
  search.setAttribute('aria-label', 'Search foods');
  search.value = query;
  search.autocomplete = 'off';
  const list = el('div', 'choice-list');
  const foods = sortFoods(state.foods.filter((food) => !food.hidden), state.date);
  for (const food of foods) {
    list.append(foodChoice(food));
  }
  if (!foods.length) list.append(el('p', 'hint', 'No foods yet. Add one below, or drop rows into foods.json.'));
  const applyFilter = () => {
    const needle = search.value.trim().toLowerCase();
    for (const node of list.querySelectorAll<HTMLElement>('[data-name]')) {
      node.hidden = needle !== '' && !(node.dataset.name ?? '').includes(needle);
    }
  };
  search.addEventListener('input', () => {
    query = search.value;
    applyFilter();
  });
  main.append(search, list);
  applyFilter();

  main.append(el('h2', 'section-title', 'Today'));
  if (!entries.length) main.append(el('p', 'lede', 'Nothing logged for this day.'));
  for (const entry of entries) main.append(entryRow(entry));

  main.append(button(showQuick ? 'Close quick add' : 'Quick add', 'secondary', () => {
    showQuick = !showQuick;
    document.dispatchEvent(new CustomEvent('dr-render'));
  }));
  if (showQuick) main.append(quickForm());

  main.append(button(showAdd ? 'Close food form' : (editingId ? 'Edit food' : 'Add food'), 'secondary', () => {
    showAdd = !showAdd;
    if (!showAdd) editingId = null;
    document.dispatchEvent(new CustomEvent('dr-render'));
  }));
  if (showAdd) main.append(foodForm(state.foods.find((food) => food.id === editingId) ?? null));

  main.append(button(showManage ? 'Close foods' : 'Manage foods', 'text-button', () => {
    showManage = !showManage;
    document.dispatchEvent(new CustomEvent('dr-render'));
  }));
  if (showManage) main.append(manageList());
}

function tallyCard(total: ReturnType<typeof tally>, target: FoodTarget | null): HTMLElement {
  const card = el('section', 'tally');
  card.append(stat('kcal', total.kcal, target?.kcal ?? null, 0));
  card.append(stat('protein', total.protein, target?.protein ?? null, 1));
  card.append(stat('carbs', total.carbs, target?.carbs ?? null, 1));
  card.append(stat('fat', total.fat, target?.fat ?? null, 1));
  const share = macroShare(total);
  const note = el('p', 'macro-note');
  note.style.gridColumn = '1 / -1';
  note.textContent = share
    ? `P ${Math.round(share.protein)}% · C ${Math.round(share.carbs)}% · F ${Math.round(share.fat)}% of macro kcal (4 / 4 / 9).`
    : 'Macro split shows once protein, carbs, or fat is logged.';
  card.append(note);
  return card;
}

function stat(label: string, value: number, goal: number | null, digits: number): HTMLElement {
  const node = el('div');
  node.append(el('span', '', label));
  node.append(el('strong', '', formatAmount(value, digits)));
  if (goal != null && goal > 0) {
    const left = goal - value;
    node.append(el('span', '', left >= 0 ? `${formatAmount(left, digits)} left` : `${formatAmount(-left, digits)} over`));
    const track = el('span', 'macro-track');
    const fill = el('i');
    fill.style.width = `${Math.min(100, (value / goal) * 100)}%`;
    track.append(fill);
    node.append(track);
  }
  return node;
}

function targetFields(target: FoodTarget | null): HTMLElement {
  const wrap = el('div');
  wrap.append(el('p', 'hint', 'Target for this day only. Leave a box blank for no target. Nothing carries to tomorrow.'));
  const grid = el('div', 'target-grid');
  grid.append(targetInput('kcal', target?.kcal ?? null, 1));
  grid.append(targetInput('P', target?.protein ?? null, 0.1));
  grid.append(targetInput('C', target?.carbs ?? null, 0.1));
  grid.append(targetInput('F', target?.fat ?? null, 0.1));
  wrap.append(grid);
  return wrap;
}

function targetInput(label: string, value: number | null, step: number): HTMLElement {
  const fieldNode = el('label');
  fieldNode.append(el('span', '', label));
  const input = el('input');
  input.type = 'number';
  input.min = '0';
  input.step = String(step);
  input.inputMode = 'decimal';
  input.value = value == null ? '' : String(value);
  input.addEventListener('change', () => {
    void saveTargets();
  });
  fieldNode.append(input);
  return fieldNode;

  async function saveTargets(): Promise<void> {
    const grid = fieldNode.parentElement;
    if (!grid) return;
    const values = [...grid.querySelectorAll('input')].map((node) => readOptional(node));
    if (values.some((item) => item === 'bad')) {
      showToast('Targets need to be zero or more.');
      return;
    }
    const [kcal, protein, carbs, fat] = values as Array<number | null>;
    const now = new Date().toISOString();
    state.foodTargets = state.foodTargets.filter((row) => row.date !== state.date);
    if (kcal != null || protein != null || carbs != null || fat != null) {
      state.foodTargets.push({ date: state.date, kcal, protein, carbs, fat, updatedAt: now });
    }
    await save();
    document.dispatchEvent(new CustomEvent('dr-render'));
  }
}

function foodChoice(food: Food): HTMLElement {
  const wrap = el('div');
  wrap.dataset.name = food.name.toLowerCase();
  const open = openFoodId === food.id;
  const hit = button(`${food.name}`, open ? 'choice selected' : 'choice', () => {
    openFoodId = open ? null : food.id;
    servingsText = '1';
    document.dispatchEvent(new CustomEvent('dr-render'));
  });
  const per = `${food.serving} · ${formatAmount(food.kcal, 0)} kcal · P ${formatAmount(food.protein, 1)} C ${formatAmount(food.carbs, 1)} F ${formatAmount(food.fat, 1)}`;
  wrap.append(hit, el('p', 'hint', per));
  if (!open) return wrap;
  const row = el('div', 'food-open');
  const servings = el('input');
  servings.type = 'number';
  servings.min = '0.1';
  servings.step = '0.1';
  servings.inputMode = 'decimal';
  servings.setAttribute('aria-label', `Servings of ${food.name}`);
  servings.value = servingsText;
  servings.addEventListener('input', () => {
    servingsText = servings.value;
  });
  row.append(servings);
  row.append(button('Add', 'primary', () => {
    const count = Number(servingsText);
    if (!Number.isFinite(count) || count <= 0) {
      showToast('Servings need to be more than zero.');
      return;
    }
    void addEntry(food, count);
  }));
  wrap.append(row);
  return wrap;
}

function entryRow(entry: FoodEntry): HTMLElement {
  const row = el('article', 'log-row');
  const amount = scaled(entry, entry.servings);
  const serving = entry.serving ? `${formatAmount(entry.servings, 1)} × ${entry.serving}` : `${formatAmount(entry.servings, 1)} serving`;
  row.append(el('p', 'log-title', entry.name));
  row.append(el('p', 'hint', `${serving} · ${formatAmount(amount.kcal, 0)} kcal · P ${formatAmount(amount.protein, 1)} C ${formatAmount(amount.carbs, 1)} F ${formatAmount(amount.fat, 1)}`));
  const actions = el('div', 'food-open');
  const servings = el('input');
  servings.type = 'number';
  servings.min = '0.1';
  servings.step = '0.1';
  servings.inputMode = 'decimal';
  servings.setAttribute('aria-label', `Servings of ${entry.name}`);
  servings.value = String(entry.servings);
  actions.append(servings);
  actions.append(button('Update', 'secondary', () => {
    const count = Number(servings.value);
    if (!Number.isFinite(count) || count <= 0) {
      showToast('Servings need to be more than zero.');
      return;
    }
    entry.servings = count;
    entry.updatedAt = new Date().toISOString();
    void save().then(() => {
      showToast('Servings updated.');
      document.dispatchEvent(new CustomEvent('dr-render'));
    });
  }));
  actions.append(button('Delete', 'text-button danger', () => {
    state.foodEntries = state.foodEntries.filter((item) => item.id !== entry.id);
    void save().then(() => {
      showToast('Removed from this day.');
      document.dispatchEvent(new CustomEvent('dr-render'));
    });
  }));
  row.append(actions);
  return row;
}

function quickForm(): HTMLElement {
  const form = el('form', 'stack');
  form.noValidate = true;
  const name = textInput('Snack');
  const kcal = numInput('0');
  const protein = numInput('0.1');
  const carbs = numInput('0.1');
  const fat = numInput('0.1');
  const servings = numInput('0.1');
  servings.value = '1';
  form.append(field('Name', name));
  form.append(field('kcal', kcal, 'Per serving'));
  form.append(field('Protein (g)', protein));
  form.append(field('Carbs (g)', carbs));
  form.append(field('Fat (g)', fat));
  form.append(field('Servings', servings, 'Not saved as a common food.'));
  form.append(button('Log this once', 'primary', () => {
    const count = Number(servings.value);
    const macros = [kcal, protein, carbs, fat].map((input) => Number(input.value));
    if (!name.value.trim() || !Number.isFinite(count) || count <= 0 || macros.some((value) => !Number.isFinite(value) || value < 0)) {
      showToast('Enter a name, servings above zero, and macros that are zero or more.');
      return;
    }
    const now = new Date().toISOString();
    state.foodEntries.push({
      id: uid(),
      date: state.date,
      foodId: null,
      name: name.value.trim(),
      serving: '',
      servings: count,
      kcal: macros[0],
      protein: macros[1],
      carbs: macros[2],
      fat: macros[3],
      loggedAt: now,
      updatedAt: now,
    });
    showQuick = false;
    void save().then(() => {
      showToast('Logged on this phone.');
      document.dispatchEvent(new CustomEvent('dr-render'));
    });
  }));
  return form;
}

function foodForm(existing: Food | null): HTMLElement {
  const form = el('form', 'stack');
  form.noValidate = true;
  const name = textInput(existing?.name ?? '');
  const serving = textInput(existing?.serving ?? '');
  serving.placeholder = '1 cup, 100 g, 1 bar';
  const kcal = numInput('1');
  const protein = numInput('0.1');
  const carbs = numInput('0.1');
  const fat = numInput('0.1');
  if (existing) {
    kcal.value = String(existing.kcal);
    protein.value = String(existing.protein);
    carbs.value = String(existing.carbs);
    fat.value = String(existing.fat);
  }
  form.append(field('Name', name));
  form.append(field('Serving', serving));
  form.append(field('kcal', kcal, 'Per serving'));
  form.append(field('Protein (g)', protein));
  form.append(field('Carbs (g)', carbs));
  form.append(field('Fat (g)', fat));
  if (existing?.source === 'repo') form.append(el('p', 'hint', 'Saving keeps this copy on the phone. Later changes in foods.json will not replace it.'));
  form.append(button(existing ? 'Save food' : 'Save new food', 'primary', () => {
    const macros = [kcal, protein, carbs, fat].map((input) => Number(input.value));
    if (!name.value.trim() || !serving.value.trim() || macros.some((value) => !Number.isFinite(value) || value < 0)) {
      showToast('Name, serving, and macros are required. Macros can be zero.');
      return;
    }
    const now = new Date().toISOString();
    if (existing) {
      const index = state.foods.findIndex((food) => food.id === existing.id);
      if (index < 0) return;
      state.foods[index] = {
        ...existing,
        name: name.value.trim(),
        serving: serving.value.trim(),
        kcal: macros[0],
        protein: macros[1],
        carbs: macros[2],
        fat: macros[3],
        edited: existing.source === 'repo' ? true : existing.edited,
        updatedAt: now,
      };
    } else {
      state.foods.push({
        id: uid(),
        name: name.value.trim(),
        serving: serving.value.trim(),
        kcal: macros[0],
        protein: macros[1],
        carbs: macros[2],
        fat: macros[3],
        source: 'custom',
        edited: false,
        hidden: false,
        useCount: 0,
        lastUsedAt: null,
        updatedAt: now,
      });
    }
    showAdd = false;
    editingId = null;
    void save().then(() => {
      showToast('Food saved on this phone.');
      document.dispatchEvent(new CustomEvent('dr-render'));
    });
  }));
  return form;
}

function manageList(): HTMLElement {
  const wrap = el('div', 'stack');
  const foods = [...state.foods].sort((a, b) => a.name.localeCompare(b.name));
  if (!foods.length) wrap.append(el('p', 'hint', 'No foods on this phone yet.'));
  for (const food of foods) {
    const row = el('article', 'log-row');
    const kind = food.source === 'custom' ? 'Yours' : food.edited ? 'Shared, edited here' : 'Shared';
    row.append(el('p', 'log-title', food.hidden ? `${food.name} · hidden` : food.name));
    row.append(el('p', 'hint', `${kind} · ${food.serving}`));
    const actions = el('div', 'row wrap');
    actions.append(button('Edit', 'text-button', () => {
      editingId = food.id;
      showAdd = true;
      showManage = false;
      document.dispatchEvent(new CustomEvent('dr-render'));
    }));
    if (food.source === 'custom') {
      actions.append(button('Delete', 'text-button danger', () => {
        if (!window.confirm(`Delete ${food.name} from this phone? Logged days keep what they already have.`)) return;
        state.foods = state.foods.filter((item) => item.id !== food.id);
        void save().then(() => document.dispatchEvent(new CustomEvent('dr-render')));
      }));
    } else if (food.hidden) {
      actions.append(button('Show again', 'text-button', () => {
        food.hidden = false;
        food.updatedAt = new Date().toISOString();
        void save().then(() => document.dispatchEvent(new CustomEvent('dr-render')));
      }));
    } else {
      actions.append(button('Hide', 'text-button', () => {
        food.hidden = true;
        food.updatedAt = new Date().toISOString();
        void save().then(() => document.dispatchEvent(new CustomEvent('dr-render')));
      }));
    }
    row.append(actions);
    wrap.append(row);
  }
  return wrap;
}

async function addEntry(food: Food, servings: number): Promise<void> {
  const now = new Date().toISOString();
  state.foodEntries.push({
    id: uid(),
    date: state.date,
    foodId: food.id,
    name: food.name,
    serving: food.serving,
    servings,
    kcal: food.kcal,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    loggedAt: now,
    updatedAt: now,
  });
  const index = state.foods.findIndex((item) => item.id === food.id);
  if (index >= 0) {
    state.foods[index] = { ...state.foods[index], useCount: state.foods[index].useCount + 1, lastUsedAt: now };
  }
  openFoodId = null;
  servingsText = '1';
  await save();
  showToast('Added.');
  document.dispatchEvent(new CustomEvent('dr-render'));
}

async function save(): Promise<void> {
  await persistDatabase({
    checkins: state.checkins,
    workouts: state.workouts,
    benchmarks: state.benchmarks,
    foods: state.foods,
    foodEntries: state.foodEntries,
    foodTargets: state.foodTargets,
  });
}

function readOptional(input: HTMLInputElement): number | null | 'bad' {
  const text = input.value.trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return 'bad';
  return value;
}

function textInput(value: string): HTMLInputElement {
  const input = el('input');
  input.type = 'text';
  input.value = value;
  input.autocomplete = 'off';
  return input;
}

function numInput(step: string): HTMLInputElement {
  const input = el('input');
  input.type = 'number';
  input.min = '0';
  input.step = step;
  input.inputMode = 'decimal';
  return input;
}

function formatAmount(value: number, digits: number): string {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return digits === 0 ? String(Math.round(rounded)) : String(rounded);
}
