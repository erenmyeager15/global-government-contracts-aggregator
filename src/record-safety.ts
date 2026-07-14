import type { ContractRecord } from './types.js';
import { normalizeText, stableRecordKey, truncateText } from './tender-utils.js';

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<![\w-])(?:\+?\d[\d\s().-]{9,13}\d)(?![\w-])/g;
const EMAIL_DETECTION_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_DETECTION_PATTERN = /(?<![\w-])(?:\+?\d[\d\s().-]{9,13}\d)(?![\w-])/;
const OFFICIAL_BASE_HOSTS: Record<ContractRecord['source'], string> = {
  uk_contracts_finder: 'contractsfinder.service.gov.uk',
  ted: 'ted.europa.eu',
  sam_gov: 'sam.gov',
};

export function redactSensitiveText(value: unknown, maximumLength = 20_000): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return truncateText(
    text
      .replace(EMAIL_PATTERN, '[redacted email]')
      .replace(PHONE_PATTERN, '[redacted phone]'),
    maximumLength,
  );
}

export function isOfficialSourceUrl(source: ContractRecord['source'], value: string): boolean {
  try {
    const url = new URL(value);
    const base = OFFICIAL_BASE_HOSTS[source];
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === base || host.endsWith(`.${base}`));
  } catch {
    return false;
  }
}

function isNormalizedDate(value: string | null): boolean {
  if (value === null) return true;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function assertSafeRecord(record: ContractRecord): ContractRecord {
  if (!record.contractId || record.contractId.length > 500) throw new Error('Record has an invalid contractId.');
  if (!record.title || record.title.length > 500) throw new Error(`Record ${record.contractId} has an invalid title.`);
  if (record.recordKey !== stableRecordKey(record.source, record.contractId)) {
    throw new Error(`Record ${record.contractId} has an inconsistent recordKey.`);
  }
  if (!record.contractUrl || !isOfficialSourceUrl(record.source, record.contractUrl)) {
    throw new Error(`Record ${record.recordKey} has a non-official contract URL.`);
  }
  if (record.contractValue !== null
    && (!Number.isFinite(record.contractValue) || record.contractValue <= 0)) {
    throw new Error(`Record ${record.recordKey} has an invalid contract value.`);
  }
  if (!isNormalizedDate(record.publishedDate)
    || !isNormalizedDate(record.lastModifiedDate)
    || !isNormalizedDate(record.deadlineDate)
    || !isNormalizedDate(record.scrapedAt)) {
    throw new Error(`Record ${record.recordKey} has an invalid normalized date.`);
  }
  if (record.classificationCodes.length > 100
    || record.classificationCodes.some((code) => !code || code.length > 500)) {
    throw new Error(`Record ${record.recordKey} has invalid classification codes.`);
  }
  if (record.description
    && (EMAIL_DETECTION_PATTERN.test(record.description) || PHONE_DETECTION_PATTERN.test(record.description))) {
    throw new Error(`Record ${record.recordKey} contains unredacted contact details.`);
  }
  return record;
}
