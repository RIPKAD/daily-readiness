import {
  basicAuthHeader,
  mapActivities,
  mapWellness,
  mapWellnessList,
  wellnessPayload,
  type ActivitySummary,
  type IntervalsPrefill,
} from './intervals-map';
import type { CheckIn } from './types';

const ATHLETE = 'https://intervals.icu/api/v1/athlete/0';

const FIELD_LABELS: Record<string, string> = {
  restingHR: 'resting HR',
  hrv: 'HRV rMSSD',
  hrvSDNN: 'HRV SDNN',
  weight: 'weight',
};

export class IntervalsError extends Error {
  readonly status: number | null;
  readonly kind: 'auth' | 'network' | 'http';

  constructor(message: string, status: number | null, kind: 'auth' | 'network' | 'http') {
    super(message);
    this.name = 'IntervalsError';
    this.status = status;
    this.kind = kind;
  }
}

export async function fetchAthleteName(apiKey: string): Promise<string> {
  const data = await call(apiKey, ATHLETE);
  if (data && typeof data === 'object' && 'name' in data && typeof data.name === 'string' && data.name.trim()) {
    return data.name.trim();
  }
  return 'your intervals.icu account';
}

export async function fetchWellnessDay(apiKey: string, date: string): Promise<IntervalsPrefill | null> {
  const data = await call(apiKey, `${ATHLETE}/wellness/${date}`);
  if (!data) return null;
  return mapWellness(data);
}

export async function fetchWellnessRange(apiKey: string, oldest: string, newest: string): Promise<{ date: string; prefill: IntervalsPrefill }[]> {
  const data = await call(apiKey, `${ATHLETE}/wellness?oldest=${oldest}&newest=${newest}`);
  return mapWellnessList(data);
}

export async function fetchActivities(apiKey: string, oldest: string, newest: string): Promise<ActivitySummary[]> {
  const data = await call(apiKey, `${ATHLETE}/activities?oldest=${oldest}&newest=${newest}`);
  return mapActivities(data, oldest);
}

export async function putWellness(apiKey: string, date: string, checkin: CheckIn): Promise<string[]> {
  const body = wellnessPayload(checkin);
  const fields = Object.keys(body);
  if (!fields.length) return [];
  await call(apiKey, `${ATHLETE}/wellness/${date}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return fields.map((field) => FIELD_LABELS[field] ?? field);
}

async function call(apiKey: string, url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? 'GET',
      body: init?.body,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: basicAuthHeader(apiKey),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new IntervalsError(
      'Could not reach intervals.icu. The log on this phone is unchanged.',
      null,
      'network',
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new IntervalsError('intervals.icu rejected the API key.', response.status, 'auth');
  }
  if (response.status === 404) return null;
  const text = await response.text();
  if (!response.ok) {
    const detail = redact(text, apiKey).replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new IntervalsError(
      detail ? `intervals.icu returned ${response.status}: ${detail}` : `intervals.icu returned ${response.status}.`,
      response.status,
      'http',
    );
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function redact(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join('…');
}
