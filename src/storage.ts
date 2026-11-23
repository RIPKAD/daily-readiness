import { cleanSettings } from './exchange';
import { DEFAULT_BASELINE_DAYS, defaultWeights } from './score';
import type { Benchmark, CheckIn, Food, FoodEntry, FoodTarget, Settings, WorkoutLog } from './types';

const DB_NAME = 'daily-readiness';
const DB_VERSION = 2;
const BACKUP_KEY = 'dr.backup.v1';
const SETTINGS_KEY = 'dr.settings.v1';
const API_KEY = 'dr.intervalsApiKey';

export type Database = {
  checkins: CheckIn[];
  workouts: WorkoutLog[];
  benchmarks: Benchmark[];
  foods: Food[];
  foodEntries: FoodEntry[];
  foodTargets: FoodTarget[];
};

let memory: Database = emptyMemory();

let warning: string | null = null;

export function storageWarning(): string | null {
  return warning;
}

export function defaultSettings(): Settings {
  return {
    baselineDays: DEFAULT_BASELINE_DAYS,
    weights: defaultWeights(),
    weeklyKjTarget: null,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    return cleanSettings(JSON.parse(raw)) ?? defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: Settings): void {
  const clean = cleanSettings(settings) ?? defaultSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
}

export function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveApiKey(key: string): void {
  localStorage.setItem(API_KEY, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY);
}

export async function loadDatabase(): Promise<Database> {
  const fromDisk = readBackup();
  let fromIdb: Database | null = null;
  try {
    fromIdb = await readIdb();
  } catch {
    warning = 'The browser database did not open. This phone is using the local storage copy.';
  }
  if (!fromIdb) return remember(fromDisk);
  if (stamp(fromIdb) >= stamp(fromDisk)) {
    writeBackup(fromIdb);
    return remember(fromIdb);
  }
  try {
    await writeIdb(fromDisk);
  } catch {
    warning = 'The newer copy is in local storage. The browser database could not be updated.';
  }
  return remember(fromDisk);
}

export async function persistDatabase(data: {
  checkins: CheckIn[];
  workouts: WorkoutLog[];
  benchmarks: Benchmark[];
  foods?: Food[];
  foodEntries?: FoodEntry[];
  foodTargets?: FoodTarget[];
}): Promise<void> {
  const next: Database = {
    checkins: data.checkins,
    workouts: data.workouts,
    benchmarks: data.benchmarks,
    foods: data.foods ?? memory.foods,
    foodEntries: data.foodEntries ?? memory.foodEntries,
    foodTargets: data.foodTargets ?? memory.foodTargets,
  };
  memory = next;
  writeBackup(next);
  try {
    await writeIdb(next);
  } catch {
    warning = 'Saved in local storage. The browser database rejected the write, and the copy on this phone is still there.';
  }
}

function remember(data: Database): Database {
  memory = data;
  return data;
}

function emptyMemory(): Database {
  return { checkins: [], workouts: [], benchmarks: [], foods: [], foodEntries: [], foodTargets: [] };
}

function withFatigue(checkin: CheckIn): CheckIn {
  return checkin.fatigue == null ? { ...checkin, fatigue: null } : checkin;
}

function emptyDb(): Database {
  return emptyMemory();
}

function stamp(data: Database): string {
  const times = [
    ...data.checkins.map((row) => row.updatedAt),
    ...data.workouts.map((row) => row.updatedAt),
    ...data.benchmarks.map((row) => row.updatedAt),
    ...data.foods.map((row) => row.updatedAt),
    ...data.foodEntries.map((row) => row.updatedAt),
    ...data.foodTargets.map((row) => row.updatedAt),
  ].filter(Boolean);
  return times.sort().at(-1) ?? '';
}

function readBackup(): Database {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw) as Partial<Database>;
    return {
      checkins: Array.isArray(parsed.checkins) ? parsed.checkins.map(withFatigue) : [],
      workouts: Array.isArray(parsed.workouts) ? parsed.workouts : [],
      benchmarks: Array.isArray(parsed.benchmarks) ? parsed.benchmarks : [],
      foods: Array.isArray(parsed.foods) ? parsed.foods : [],
      foodEntries: Array.isArray(parsed.foodEntries) ? parsed.foodEntries : [],
      foodTargets: Array.isArray(parsed.foodTargets) ? parsed.foodTargets : [],
    };
  } catch {
    return emptyDb();
  }
}

function writeBackup(data: Database): void {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(data));
  } catch {
    warning = 'This phone refused to store the backup. Free a little space and export a JSON copy from Settings.';
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('checkins')) db.createObjectStore('checkins', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('workouts')) db.createObjectStore('workouts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('benchmarks')) db.createObjectStore('benchmarks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('foods')) db.createObjectStore('foods', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('foodEntries')) db.createObjectStore('foodEntries', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('foodTargets')) db.createObjectStore('foodTargets', { keyPath: 'date' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed to open'));
  });
}

async function readIdb(): Promise<Database> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['checkins', 'workouts', 'benchmarks', 'foods', 'foodEntries', 'foodTargets'], 'readonly');
      const checkins = tx.objectStore('checkins').getAll();
      const workouts = tx.objectStore('workouts').getAll();
      const benchmarks = tx.objectStore('benchmarks').getAll();
      const foods = tx.objectStore('foods').getAll();
      const foodEntries = tx.objectStore('foodEntries').getAll();
      const foodTargets = tx.objectStore('foodTargets').getAll();
      tx.oncomplete = () => resolve({
        checkins: (checkins.result as CheckIn[]).map(withFatigue),
        workouts: workouts.result as WorkoutLog[],
        benchmarks: benchmarks.result as Benchmark[],
        foods: foods.result as Food[],
        foodEntries: foodEntries.result as FoodEntry[],
        foodTargets: foodTargets.result as FoodTarget[],
      });
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function writeIdb(data: Database): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['checkins', 'workouts', 'benchmarks', 'foods', 'foodEntries', 'foodTargets'], 'readwrite');
      tx.objectStore('checkins').clear();
      tx.objectStore('workouts').clear();
      tx.objectStore('benchmarks').clear();
      tx.objectStore('foods').clear();
      tx.objectStore('foodEntries').clear();
      tx.objectStore('foodTargets').clear();
      for (const row of data.checkins) tx.objectStore('checkins').put(row);
      for (const row of data.workouts) tx.objectStore('workouts').put(row);
      for (const row of data.benchmarks) tx.objectStore('benchmarks').put(row);
      for (const row of data.foods) tx.objectStore('foods').put(row);
      for (const row of data.foodEntries) tx.objectStore('foodEntries').put(row);
      for (const row of data.foodTargets) tx.objectStore('foodTargets').put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
