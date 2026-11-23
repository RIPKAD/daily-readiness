import { parseBackup, type Backup } from './exchange';
import { state } from './state';
import type { Settings } from './types';

export const GITHUB_BACKUP_SCHEMA_VERSION = 1;
export const SYNC_DEBOUNCE_MS = 2500;
export const DEFAULT_GITHUB_REPO = 'RIPKAD/daily-readiness-data';
const BACKUP_PATH = 'backup.json';

const TOKEN_KEY = 'dr.githubToken';
const REPO_KEY = 'dr.githubRepo';
const AUTO_KEY = 'dr.githubAutoSync';
const STATUS_KEY = 'dr.githubSyncStatus';

export type GithubBackup = {
  schemaVersion: number;
  updatedAt: string;
  settings: Pick<Settings, 'baselineDays' | 'weights' | 'weeklyKjTarget'> | null;
  checkins: Backup['checkins'];
  workouts: Backup['workouts'];
  benchmarks: Backup['benchmarks'];
  foods: Backup['foods'];
  foodEntries: Backup['foodEntries'];
  foodTargets: Backup['foodTargets'];
  strengthSessions: Backup['strengthSessions'];
  strengthTemplates: Backup['strengthTemplates'];
  hiddenFoodIds: string[];
};

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'ok';

export type SyncStatus = {
  phase: SyncPhase;
  message: string;
  at: string | null;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let status: SyncStatus = loadStatus();
let timer = 0;
let running = false;
let queued = false;
let started = false;

export function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function decodeUtf8Base64(encoded: string): string {
  const binary = atob(encoded.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function parseRepo(value: string): { owner: string; repo: string } | null {
  const match = value.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export function loadGithubRepo(): string {
  try {
    return localStorage.getItem(REPO_KEY)?.trim() || DEFAULT_GITHUB_REPO;
  } catch {
    return DEFAULT_GITHUB_REPO;
  }
}

export function loadGithubToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function loadAutoSync(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_KEY);
    if (raw == null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

export function saveGithubSettings(repo: string, token: string | null, autoSync: boolean): string | null {
  const parsed = parseRepo(repo);
  if (!parsed) return 'Use owner/repo, for example RIPKAD/daily-readiness-data.';
  localStorage.setItem(REPO_KEY, `${parsed.owner}/${parsed.repo}`);
  if (token != null) {
    const trimmed = token.trim();
    if (trimmed) localStorage.setItem(TOKEN_KEY, trimmed);
  }
  localStorage.setItem(AUTO_KEY, autoSync ? '1' : '0');
  return null;
}

export function clearGithubToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function buildGithubBackup(now = new Date().toISOString()): GithubBackup {
  return {
    schemaVersion: GITHUB_BACKUP_SCHEMA_VERSION,
    updatedAt: now,
    settings: state.settings
      ? {
        baselineDays: state.settings.baselineDays,
        weights: state.settings.weights,
        weeklyKjTarget: state.settings.weeklyKjTarget,
      }
      : null,
    checkins: state.checkins,
    workouts: state.workouts,
    benchmarks: state.benchmarks,
    foods: state.foods,
    foodEntries: state.foodEntries,
    foodTargets: state.foodTargets,
    strengthSessions: state.strengthSessions,
    strengthTemplates: state.strengthTemplates,
    hiddenFoodIds: state.hiddenFoodIds,
  };
}

export function serializeGithubBackup(backup: GithubBackup): string {
  return JSON.stringify(backup, null, 2);
}

export function parseGithubBackup(text: string): { ok: true; backup: Backup; updatedAt: string } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The GitHub backup is not valid JSON.' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'The GitHub backup was empty.' };
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== GITHUB_BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: 'This backup uses a schema this app does not read yet.' };
  }
  const wrapped = {
    kind: 'daily-readiness',
    version: 1,
    settings: record.settings,
    checkins: record.checkins,
    workouts: record.workouts,
    benchmarks: record.benchmarks,
    foods: record.foods,
    foodEntries: record.foodEntries,
    foodTargets: record.foodTargets,
    strengthSessions: record.strengthSessions,
    strengthTemplates: record.strengthTemplates,
    hiddenFoodIds: record.hiddenFoodIds,
  };
  const parsed = parseBackup(JSON.stringify(wrapped));
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    backup: parsed.backup,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
  };
}

export type PushResult = { ok: true; sha: string } | { ok: false; message: string; offline?: boolean };

export async function pushBackup(
  config: { owner: string; repo: string; token: string },
  json: string,
  fetchImpl: FetchLike = fetch,
): Promise<PushResult> {
  const read = await readRemote(config, fetchImpl);
  if (!read.ok && read.status !== 404) return { ok: false, message: read.message };
  const firstSha = read.ok ? read.sha : null;
  const wrote = await writeRemote(config, json, firstSha, fetchImpl);
  if (wrote.ok) return wrote;
  if (wrote.status !== 409) return { ok: false, message: wrote.message };
  const again = await readRemote(config, fetchImpl);
  if (!again.ok) return { ok: false, message: again.message };
  const retry = await writeRemote(config, json, again.sha, fetchImpl);
  if (retry.ok) return retry;
  return { ok: false, message: retry.status === 409
    ? 'GitHub had a newer copy. Local data is safe. Try Sync now again.'
    : retry.message };
}

export function startGithubSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => {
    scheduleGithubSync(0);
  });
}

export function scheduleGithubSync(delay = SYNC_DEBOUNCE_MS): void {
  if (!loadGithubToken() || !loadAutoSync()) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void runPush();
  }, delay);
}

export async function syncNow(): Promise<void> {
  window.clearTimeout(timer);
  await runPush();
}

export async function restoreFromGithub(): Promise<{ ok: true; backup: Backup; updatedAt: string } | { ok: false; message: string }> {
  const config = currentConfig();
  if (!config) return { ok: false, message: 'Save a token and an owner/repo first.' };
  if (offline()) {
    const message = 'Offline. Local data is unchanged.';
    setStatus({ phase: 'offline', message, at: status.at });
    return { ok: false, message };
  }
  setStatus({ phase: 'syncing', message: 'Restoring…', at: status.at });
  const read = await readRemote(config, fetch);
  if (!read.ok) {
    const message = read.status === 404 ? 'No backup.json on that repo yet. Local data is unchanged.' : read.message;
    setStatus({ phase: 'error', message, at: status.at });
    return { ok: false, message };
  }
  const parsed = parseGithubBackup(read.json);
  if (!parsed.ok) {
    setStatus({ phase: 'error', message: parsed.error, at: status.at });
    return { ok: false, message: parsed.error };
  }
  setStatus({ phase: 'ok', message: `Restored ${formatWhen(parsed.updatedAt)}.`, at: new Date().toISOString() });
  return parsed;
}

async function runPush(): Promise<void> {
  if (running) {
    queued = true;
    return;
  }
  const config = currentConfig();
  if (!config) return;
  if (offline()) {
    setStatus({ phase: 'offline', message: 'Offline. Local data is safe. Sync will retry when you are back online.', at: status.at });
    return;
  }
  running = true;
  setStatus({ phase: 'syncing', message: 'Syncing…', at: status.at });
  try {
    const json = serializeGithubBackup(buildGithubBackup());
    const result = await pushBackup(config, json);
    if (!result.ok) {
      setStatus({ phase: result.offline ? 'offline' : 'error', message: result.message, at: status.at });
      return;
    }
    const at = new Date().toISOString();
    setStatus({ phase: 'ok', message: `Last synced ${formatWhen(at)}.`, at });
  } catch (error) {
    const offlineError = error instanceof TypeError;
    setStatus({
      phase: offlineError ? 'offline' : 'error',
      message: offlineError
        ? 'Offline. Local data is safe. Sync will retry when you are back online.'
        : 'Sync failed. Local data is safe.',
      at: status.at,
    });
  } finally {
    running = false;
    if (queued) {
      queued = false;
      scheduleGithubSync();
    }
  }
}

function currentConfig(): { owner: string; repo: string; token: string } | null {
  const token = loadGithubToken();
  const parsed = parseRepo(loadGithubRepo());
  if (!token || !parsed) return null;
  return { ...parsed, token };
}

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function readRemote(config: { owner: string; repo: string; token: string }, fetchImpl: FetchLike): Promise<
  { ok: true; sha: string; json: string } | { ok: false; status: number; message: string }
> {
  let response: Response;
  try {
    response = await fetchImpl(contentsUrl(config), { headers: headers(config.token) });
  } catch {
    return { ok: false, status: 0, message: 'Offline. Local data is safe. Sync will retry when you are back online.' };
  }
  if (response.status === 404) return { ok: false, status: 404, message: 'backup.json is not in the repo yet.' };
  if (!response.ok) return { ok: false, status: response.status, message: errorMessage(response.status) };
  const body = await response.json() as { sha?: string; content?: string };
  if (!body.sha || typeof body.content !== 'string') return { ok: false, status: 502, message: 'GitHub returned a backup without a sha.' };
  return { ok: true, sha: body.sha, json: decodeUtf8Base64(body.content) };
}

async function writeRemote(
  config: { owner: string; repo: string; token: string },
  json: string,
  sha: string | null,
  fetchImpl: FetchLike,
): Promise<{ ok: true; sha: string } | { ok: false; status: number; message: string }> {
  const payload: Record<string, string> = {
    message: 'Sync daily readiness backup',
    content: encodeUtf8Base64(json),
    branch: 'main',
  };
  if (sha) payload.sha = sha;
  let response: Response;
  try {
    response = await fetchImpl(contentsUrl(config), {
      method: 'PUT',
      headers: { ...headers(config.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, status: 0, message: 'Offline. Local data is safe. Sync will retry when you are back online.' };
  }
  if (response.status === 409) return { ok: false, status: 409, message: 'GitHub had a newer copy.' };
  if (response.status === 404) return { ok: false, status: 404, message: 'Repository not found, or the token cannot see it.' };
  if (!response.ok) return { ok: false, status: response.status, message: errorMessage(response.status) };
  const body = await response.json() as { content?: { sha?: string } };
  return { ok: true, sha: body.content?.sha ?? sha ?? '' };
}

function contentsUrl(config: { owner: string; repo: string }): string {
  return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${BACKUP_PATH}`;
}

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'daily-readiness',
  };
}

function errorMessage(status: number): string {
  if (status === 401) return 'GitHub rejected the token.';
  if (status === 403) return 'GitHub refused this token. It needs contents read and write on the repo.';
  if (status === 404) return 'Repository not found, or the token cannot see it.';
  if (status === 0) return 'Offline. Local data is safe. Sync will retry when you are back online.';
  return `GitHub sync failed (${status}). Local data is safe.`;
}

function setStatus(next: SyncStatus): void {
  status = next;
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(next));
  } catch {
    // Status is local-only. A full disk must not affect the log.
  }
  const node = document.getElementById('github-sync-status');
  if (node) node.textContent = next.message;
}

function loadStatus(): SyncStatus {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    if (!raw) return { phase: 'idle', message: 'Not synced yet.', at: null };
    const parsed = JSON.parse(raw) as Partial<SyncStatus>;
    if (!parsed.message || typeof parsed.message !== 'string') return { phase: 'idle', message: 'Not synced yet.', at: null };
    return {
      phase: parsed.phase ?? 'idle',
      message: parsed.message,
      at: typeof parsed.at === 'string' ? parsed.at : null,
    };
  } catch {
    return { phase: 'idle', message: 'Not synced yet.', at: null };
  }
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
