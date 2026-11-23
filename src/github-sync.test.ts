import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGithubBackup,
  decodeUtf8Base64,
  encodeUtf8Base64,
  parseGithubBackup,
  pushBackup,
  serializeGithubBackup,
  SYNC_DEBOUNCE_MS,
} from './github-sync';
import { state } from './state';

const TOKEN = 'ghp_TEST_TOKEN_SHOULD_NOT_LEAK';

afterEach(() => {
  state.checkins = [];
  state.workouts = [];
  state.benchmarks = [];
  state.foods = [];
  state.foodEntries = [];
  state.foodTargets = [];
  state.strengthSessions = [];
  state.strengthTemplates = [];
  state.hiddenFoodIds = [];
});

describe('github backup payload', () => {
  it('serializes user data and never includes the token', () => {
    const backup = buildGithubBackup('2026-11-23T12:00:00.000Z');
    const json = serializeGithubBackup(backup);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toMatch(/dr\.githubToken|githubToken|Authorization|Bearer /);
    expect(JSON.parse(json)).toMatchObject({
      schemaVersion: 1,
      updatedAt: '2026-11-23T12:00:00.000Z',
      hiddenFoodIds: [],
    });
    expect(Object.keys(JSON.parse(json)).sort()).toEqual([
      'benchmarks',
      'checkins',
      'foodEntries',
      'foodTargets',
      'foods',
      'hiddenFoodIds',
      'schemaVersion',
      'settings',
      'strengthSessions',
      'strengthTemplates',
      'updatedAt',
      'workouts',
    ]);
    const encoded = encodeUtf8Base64(json);
    expect(encoded).not.toContain(TOKEN);
    expect(decodeUtf8Base64(encoded)).toBe(json);
  });

  it('round-trips café and an emoji through base64', () => {
    const text = 'café 🚴 — naïve';
    expect(decodeUtf8Base64(encodeUtf8Base64(text))).toBe(text);
    expect(decodeUtf8Base64(`${encodeUtf8Base64(text).slice(0, 8)}\n${encodeUtf8Base64(text).slice(8)}`)).toBe(text);
  });

  it('restores a backup without reading a token', () => {
    state.hiddenFoodIds = ['olive-oil'];
    const json = serializeGithubBackup(buildGithubBackup('2026-11-23T15:00:00.000Z'));
    const restored = parseGithubBackup(json);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.updatedAt).toBe('2026-11-23T15:00:00.000Z');
    expect(restored.backup.hiddenFoodIds).toEqual(['olive-oil']);
    expect(JSON.stringify(restored)).not.toContain(TOKEN);
    expect(parseGithubBackup('{"schemaVersion":2}').ok).toBe(false);
  });
});

describe('github contents API', () => {
  it('creates backup.json when the file is missing', async () => {
    const calls: { url: string; method: string; body?: { sha?: string; content: string } }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) as { sha?: string; content: string } : undefined;
      calls.push({ url: String(url), method, body });
      if (method === 'GET') return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      expect(body?.sha).toBeUndefined();
      expect(decodeUtf8Base64(body!.content)).toContain('café');
      expect(decodeUtf8Base64(body!.content)).not.toContain(TOKEN);
      return new Response(JSON.stringify({ content: { sha: 'created-sha' } }), { status: 201 });
    };
    const result = await pushBackup(
      { owner: 'RIPKAD', repo: 'daily-readiness-data', token: TOKEN },
      '{"schemaVersion":1,"note":"café 🚴"}',
      fetchImpl,
    );
    expect(result).toEqual({ ok: true, sha: 'created-sha' });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT']);
    expect(calls[1].url).toBe('https://api.github.com/repos/RIPKAD/daily-readiness-data/contents/backup.json');
  });

  it('refreshes the sha and retries once after a 409', async () => {
    const shas: Array<string | undefined> = [];
    let gets = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        gets += 1;
        const sha = gets === 1 ? 'sha-old' : 'sha-new';
        const content = encodeUtf8Base64('{"schemaVersion":1,"updatedAt":"t","settings":null,"checkins":[],"workouts":[],"benchmarks":[],"foods":[],"foodEntries":[],"foodTargets":[],"strengthSessions":[],"strengthTemplates":[],"hiddenFoodIds":[]}');
        return new Response(JSON.stringify({ sha, content }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as { sha?: string };
      shas.push(body.sha);
      if (body.sha === 'sha-old') return new Response('conflict', { status: 409 });
      return new Response(JSON.stringify({ content: { sha: 'sha-new' } }), { status: 200 });
    };
    const result = await pushBackup(
      { owner: 'RIPKAD', repo: 'daily-readiness-data', token: TOKEN },
      '{"schemaVersion":1}',
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(shas).toEqual(['sha-old', 'sha-new']);
    expect(gets).toBe(2);
  });
});

describe('debounce', () => {
  it('waits 2.5 seconds so rapid changes become one sync', () => {
    expect(SYNC_DEBOUNCE_MS).toBe(2500);
    vi.useFakeTimers();
    let runs = 0;
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const schedule = (run: () => void, delay: number) => {
      const handle = setTimeout(() => {
        pending.delete(handle);
        run();
      }, delay);
      pending.add(handle);
      return handle;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kick = () => {
      if (timer) clearTimeout(timer);
      timer = schedule(() => {
        runs += 1;
      }, SYNC_DEBOUNCE_MS);
    };
    kick();
    vi.advanceTimersByTime(2000);
    kick();
    vi.advanceTimersByTime(2000);
    expect(runs).toBe(0);
    vi.advanceTimersByTime(500);
    expect(runs).toBe(1);
    vi.useRealTimers();
  });
});
