import type { ContractRecord } from './types.js';

export type MatchField =
  | 'description'
  | 'title'
  | 'classificationCodes'
  | 'buyerName'
  | 'buyerCountry'
  | 'buyerRegion'
  | 'noticeType'
  | 'stage'
  | 'procurementMethod';

export interface KeywordMatch {
  matched: boolean;
  matchedFields: MatchField[];
  matchReason: string | null;
}

export interface NormalizeDateTimeOptions {
  dateOnlyAsEndOfDay?: boolean;
}

export function normalizeText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function truncateText(value: unknown, maximumLength: number): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return text.length <= maximumLength ? text : `${text.slice(0, maximumLength - 3)}...`;
}

function isCalendarDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function normalizeDateTime(
  value: unknown,
  options: NormalizeDateTimeOptions = {},
): string | null {
  const text = normalizeText(value);
  if (!text) return null;

  // TED returns calendar dates with an offset but no time, for example
  // 2026-07-01+02:00. Treat those as calendar dates rather than invalid datetimes.
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})(?:Z|[+-]\d{2}:\d{2})?$/);
  if (dateOnly && !isCalendarDate(dateOnly[1])) return null;
  const dateTime = text.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (!dateOnly && (!dateTime || !isCalendarDate(dateTime[1]))) return null;
  let candidate = dateOnly
    ? `${dateOnly[1]}T${options.dateOnlyAsEndOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : text;
  if (!dateOnly && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(candidate)) candidate = `${candidate}Z`;

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

export function latestDateTime(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];
  const dates = values
    .map((item) => normalizeDateTime(item))
    .filter((item): item is string => item !== null)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
  return dates[0] ?? null;
}

export function latestDeadlineDateTime(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];
  const dates = values
    .map((item) => normalizeDateTime(item, { dateOnlyAsEndOfDay: true }))
    .filter((item): item is string => item !== null)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
  return dates[0] ?? null;
}

export function stableRecordKey(source: ContractRecord['source'], contractId: string): string {
  return `${source}:${contractId}`;
}

function withoutUrls(value: string | null): string | null {
  return normalizeText(value?.replace(/(?:https?:\/\/|www\.)\S+/gi, ' '));
}

function searchableFields(record: ContractRecord): Array<[MatchField, string | null]> {
  return [
    ['description', withoutUrls(record.description)],
    ['title', record.title],
    ['classificationCodes', normalizeText(record.classificationCodes.join(' '))],
    ['buyerName', record.buyerName],
    ['buyerCountry', record.buyerCountry],
    ['buyerRegion', record.buyerRegion],
    ['noticeType', record.noticeType],
    ['stage', record.stage],
    ['procurementMethod', record.procurementMethod],
  ];
}

export function keywordMatch(record: ContractRecord, keyword: string | null): KeywordMatch {
  const normalizedKeyword = normalizeText(keyword)?.toLowerCase() ?? null;
  if (!normalizedKeyword) {
    return { matched: true, matchedFields: [], matchReason: null };
  }

  const matchedFields = searchableFields(record)
    .filter(([, value]) => value?.toLowerCase().includes(normalizedKeyword))
    .map(([field]) => field);

  return {
    matched: matchedFields.length > 0,
    matchedFields,
    matchReason: matchedFields.length > 0
      ? `Keyword "${keyword}" matched ${matchedFields.join(', ')}.`
      : null,
  };
}

export function locationMatches(record: ContractRecord, value: string | null): boolean {
  const normalizedValue = normalizeText(value)?.toLowerCase() ?? null;
  if (!normalizedValue) return true;

  const location = `${record.buyerCountry ?? ''} ${record.buyerRegion ?? ''}`.toLowerCase();
  if (normalizedValue === 'uk' || normalizedValue === 'united kingdom') {
    return ['united kingdom', 'england', 'scotland', 'wales', 'northern ireland']
      .some((candidate) => location.includes(candidate));
  }
  const countryCodeNames: Record<string, string> = {
    aut: 'austria', bel: 'belgium', bgr: 'bulgaria', hrv: 'croatia', cyp: 'cyprus',
    cze: 'czechia', dnk: 'denmark', est: 'estonia', fin: 'finland', fra: 'france',
    deu: 'germany', grc: 'greece', hun: 'hungary', irl: 'ireland', ita: 'italy',
    lva: 'latvia', ltu: 'lithuania', lux: 'luxembourg', mlt: 'malta', nld: 'netherlands',
    pol: 'poland', prt: 'portugal', rou: 'romania', svk: 'slovakia', svn: 'slovenia',
    esp: 'spain', swe: 'sweden', nor: 'norway', isl: 'iceland', lie: 'liechtenstein',
    che: 'switzerland', gbr: 'united kingdom', usa: 'united states',
  };
  const country = record.buyerCountry?.toLowerCase() ?? '';
  const officialName = countryCodeNames[country];
  if (officialName && (officialName.includes(normalizedValue) || normalizedValue.includes(officialName))) return true;
  const requestedCode = Object.entries(countryCodeNames)
    .find(([, name]) => name === normalizedValue)?.[0];
  if (requestedCode && country === requestedCode) return true;
  return location.includes(normalizedValue);
}

export function chooseNewerRecord(
  existing: ContractRecord | undefined,
  candidate: ContractRecord,
): ContractRecord {
  if (!existing) return candidate;
  const timestamp = (record: ContractRecord): number => {
    const value = record.lastModifiedDate ?? record.publishedDate ?? record.scrapedAt;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  if (timestamp(candidate) !== timestamp(existing)) {
    return timestamp(candidate) > timestamp(existing) ? candidate : existing;
  }

  const completeness = (record: ContractRecord): number => [
    record.buyerName,
    record.buyerCountry,
    record.buyerRegion,
    record.contractValue,
    record.deadlineDate,
    record.description,
    ...record.classificationCodes,
  ].filter((value) => value !== null && value !== '').length;
  return completeness(candidate) > completeness(existing) ? candidate : existing;
}
