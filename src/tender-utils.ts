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
  referenceValue?: unknown;
  dateOnlyAsEndOfDay?: boolean;
}

export function normalizeText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function normalizeDateTime(
  value: unknown,
  options: NormalizeDateTimeOptions = {},
): string | null {
  const text = normalizeText(value);
  if (!text) return null;

  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})$/);
  const candidate = dateOnly
    ? `${dateOnly[1]}T${options.dateOnlyAsEndOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : text;

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;

  const reference = options.referenceValue
    ? normalizeDateTime(options.referenceValue)
    : null;
  if (reference) {
    const referenceDate = new Date(reference);
    if (parsed.getUTCFullYear() < referenceDate.getUTCFullYear() - 1) {
      const repaired = candidate.replace(/^\d{4}/, String(referenceDate.getUTCFullYear()));
      const repairedDate = new Date(repaired);
      if (!Number.isNaN(repairedDate.getTime()) && repairedDate >= referenceDate) {
        return repairedDate.toISOString();
      }
    }
  }

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

export function containsSearchText(record: ContractRecord, value: string | null): boolean {
  const normalizedValue = normalizeText(value)?.toLowerCase() ?? null;
  if (!normalizedValue) return true;
  return searchableFields(record).some(([, fieldValue]) =>
    fieldValue?.toLowerCase().includes(normalizedValue));
}
