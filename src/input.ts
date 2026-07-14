import type { DecisionProfileInput, NormalizedInput, SourceName } from './types.js';
import { normalizeDecisionProfile } from './tender-intelligence.js';
import { normalizeText } from './tender-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DATE_RANGE_DAYS = 365;
const VALID_SOURCES = new Set<SourceName>(['uk_contracts_finder', 'ted', 'sam_gov']);
const TOP_LEVEL_FIELDS = new Set([
  'sources',
  'keywords',
  'dateFrom',
  'dateTo',
  'country',
  'noticeStatus',
  'decisionProfile',
  'maxResults',
  'samApiKey',
  'proxyConfiguration',
]);
const PROFILE_FIELDS = new Set([
  'preferredKeywords',
  'preferredRegions',
  'preferredCategories',
  'excludedKeywords',
  'minimumContractValue',
  'minimumValueCurrency',
  'minimumDaysToDeadline',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertKnownFields(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported field(s): ${unknown.join(', ')}.`);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value: unknown, label: string): { text: string; timestamp: number } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`${label} must be a real calendar date.`);
  }
  return { text: value, timestamp };
}

function boundedText(value: unknown, label: string, maximumLength: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  if (/\r|\n|\0/.test(value)) throw new Error(`${label} cannot contain control characters.`);
  const text = normalizeText(value);
  if (!text) return null;
  if (text.length > maximumLength) throw new Error(`${label} must be at most ${maximumLength} characters.`);
  return text;
}

function stringArray(
  value: unknown,
  label: string,
  maximumItems: number,
  maximumLength: number,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  if (value.length > maximumItems) throw new Error(`${label} supports at most ${maximumItems} items.`);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = boundedText(item, `${label} item`, maximumLength);
    if (!text) throw new Error(`${label} cannot contain empty items.`);
    const key = text.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(text);
    }
  }
  return result;
}

function normalizeSources(value: unknown): SourceName[] {
  if (value === undefined) return ['uk_contracts_finder', 'ted'];
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error('sources must contain between 1 and 3 supported sources.');
  }

  const result: SourceName[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('Each source must be a string.');
    const source = item.trim().toLowerCase() as SourceName;
    if (!VALID_SOURCES.has(source)) throw new Error(`Unsupported source: ${item}.`);
    if (!result.includes(source)) result.push(source);
  }
  if (!result.length) throw new Error('At least one supported source is required.');
  return result;
}

function normalizeProfile(value: unknown): DecisionProfileInput | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) throw new Error('decisionProfile must be an object.');
  assertKnownFields(value, PROFILE_FIELDS, 'decisionProfile');

  const profile: DecisionProfileInput = {
    preferredKeywords: stringArray(value.preferredKeywords, 'decisionProfile.preferredKeywords', 20, 100),
    preferredRegions: stringArray(value.preferredRegions, 'decisionProfile.preferredRegions', 20, 100),
    preferredCategories: stringArray(value.preferredCategories, 'decisionProfile.preferredCategories', 20, 100),
    excludedKeywords: stringArray(value.excludedKeywords, 'decisionProfile.excludedKeywords', 20, 100),
  };

  if (value.minimumContractValue !== undefined) {
    if (typeof value.minimumContractValue !== 'number'
      || !Number.isFinite(value.minimumContractValue)
      || value.minimumContractValue < 0) {
      throw new Error('decisionProfile.minimumContractValue must be a non-negative number.');
    }
    profile.minimumContractValue = value.minimumContractValue;
  }

  const currency = boundedText(value.minimumValueCurrency, 'decisionProfile.minimumValueCurrency', 3);
  if (currency && !/^[A-Za-z]{3}$/.test(currency)) {
    throw new Error('decisionProfile.minimumValueCurrency must be a three-letter currency code.');
  }
  if (currency) profile.minimumValueCurrency = currency.toUpperCase();
  if (profile.minimumContractValue !== undefined && !profile.minimumValueCurrency) {
    throw new Error('decisionProfile.minimumValueCurrency is required with minimumContractValue.');
  }

  if (value.minimumDaysToDeadline !== undefined) {
    if (!Number.isInteger(value.minimumDaysToDeadline)
      || (value.minimumDaysToDeadline as number) < 0
      || (value.minimumDaysToDeadline as number) > 365) {
      throw new Error('decisionProfile.minimumDaysToDeadline must be an integer from 0 to 365.');
    }
    profile.minimumDaysToDeadline = value.minimumDaysToDeadline as number;
  }
  return profile;
}

function validateDisabledProxy(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) throw new Error('proxyConfiguration must be an object.');
  assertKnownFields(value, new Set(['useApifyProxy', 'groups', 'countryCode', 'proxyUrls']), 'proxyConfiguration');
  const proxyUrls = Array.isArray(value.proxyUrls) ? value.proxyUrls : [];
  const groups = Array.isArray(value.groups) ? value.groups : [];
  if ((value.useApifyProxy !== undefined && value.useApifyProxy !== false)
    || proxyUrls.length
    || groups.length
    || normalizeText(value.countryCode)) {
    throw new Error('Proxy routing is not supported for these official API sources; keep proxyConfiguration disabled.');
  }
}

export function normalizeInput(raw: unknown, now = new Date()): NormalizedInput {
  const input = raw === null || raw === undefined ? {} : raw;
  if (!isPlainObject(input)) throw new Error('Input must be a JSON object.');
  assertKnownFields(input, TOP_LEVEL_FIELDS, 'Input');

  const sources = normalizeSources(input.sources);
  const keywords = input.keywords === undefined
    ? ['software']
    : stringArray(input.keywords, 'keywords', 10, 100);

  const today = isoDate(now);
  const defaultFrom = isoDate(new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ) - 30 * DAY_MS));
  const from = parseDateOnly(input.dateFrom ?? defaultFrom, 'dateFrom');
  const to = parseDateOnly(input.dateTo ?? today, 'dateTo');
  if (from.timestamp > to.timestamp) throw new Error('dateFrom cannot be later than dateTo.');
  if ((to.timestamp - from.timestamp) / DAY_MS > MAX_DATE_RANGE_DAYS) {
    throw new Error(`The publication date range cannot exceed ${MAX_DATE_RANGE_DAYS + 1} calendar days.`);
  }

  const country = boundedText(input.country, 'country', 100);
  const noticeStatus = input.noticeStatus ?? 'active';
  if (noticeStatus !== 'active' && noticeStatus !== 'all') {
    throw new Error('noticeStatus must be either active or all.');
  }

  const maxResults = input.maxResults ?? 10;
  if (!Number.isInteger(maxResults) || (maxResults as number) < 1 || (maxResults as number) > 1000) {
    throw new Error('maxResults must be an integer from 1 to 1000.');
  }

  const samApiKey = boundedText(input.samApiKey, 'samApiKey', 512);
  if (sources.includes('sam_gov') && !samApiKey) {
    throw new Error('samApiKey is required when sam_gov is selected.');
  }
  validateDisabledProxy(input.proxyConfiguration);

  const decisionProfileInput = normalizeProfile(input.decisionProfile);
  return {
    sources,
    keywords,
    dateFrom: from.text,
    dateTo: to.text,
    country,
    noticeStatus,
    maxResults: maxResults as number,
    samApiKey,
    decisionProfile: normalizeDecisionProfile(decisionProfileInput, keywords),
  };
}
