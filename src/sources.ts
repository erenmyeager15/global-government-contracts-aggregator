import type { JsonFetcher } from './http.js';
import { fetchJson } from './http.js';
import { isOfficialSourceUrl, redactSensitiveText } from './record-safety.js';
import type {
  ContractRecord,
  NormalizedInput,
  SamOpportunity,
  SamSearchResponse,
  SourceName,
  TedNotice,
  UkOcdsRelease,
} from './types.js';
import {
  chooseNewerRecord,
  keywordMatch,
  latestDeadlineDateTime,
  latestDateTime,
  locationMatches,
  normalizeDateTime,
  normalizeText,
  stableRecordKey,
  truncateText,
} from './tender-utils.js';

const SOURCE_PACING_MS: Record<SourceName, number> = {
  uk_contracts_finder: 250,
  ted: 250,
  sam_gov: 250,
};

interface UkSearchResponse {
  releases?: UkOcdsRelease[];
  links?: { next?: string | null };
}

export interface SourceScrapeOptions {
  input: NormalizedInput;
  keyword: string | null;
  limit: number;
  excludedKeys: ReadonlySet<string>;
  fetcher?: JsonFetcher;
  now?: Date;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function firstText(value: unknown): string | null {
  if (value === null || value === undefined || value === false) return null;
  if (typeof value === 'string' || typeof value === 'number') return normalizeText(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstText(item);
      if (text) return text;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const text = firstText(item);
      if (text) return text;
    }
  }
  return null;
}

function preferredText(value: unknown): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const translations = value as Record<string, unknown>;
    for (const language of ['eng', 'ENG', 'en']) {
      const text = firstText(translations[language]);
      if (text) return text;
    }
  }
  return firstText(value);
}

function allText(value: unknown, result: string[] = []): string[] {
  if (value === null || value === undefined || value === false) return result;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = normalizeText(value);
    if (text) result.push(text);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) allText(item, result);
    return result;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) allText(item, result);
  }
  return result;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = normalizeText(value)?.replace(/,/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function contractValueOrNull(value: unknown): number | null {
  const amount = numberOrNull(value);
  return amount !== null && amount > 0 ? amount : null;
}

function compactCodes(...values: unknown[]): string[] {
  const codes = new Map<string, string>();
  for (const value of values) {
    for (const candidate of allText(value)) {
      const text = truncateText(candidate, 500);
      if (text && !codes.has(text.toLowerCase())) codes.set(text.toLowerCase(), text);
      if (codes.size >= 100) break;
    }
    if (codes.size >= 100) break;
  }
  return [...codes.values()];
}

function officialUrl(
  source: ContractRecord['source'],
  candidate: unknown,
  fallback: string,
): string {
  const value = normalizeText(candidate);
  return value && isOfficialSourceUrl(source, value) ? value : fallback;
}

function withFilters(
  record: ContractRecord,
  keyword: string | null,
  country: string | null,
): ContractRecord | null {
  const match = keywordMatch(record, keyword);
  if (!match.matched || !locationMatches(record, country)) return null;
  return { ...record, matchedFields: match.matchedFields, matchReason: match.matchReason };
}

function isActiveTender(record: ContractRecord, now: Date): boolean {
  if (record.stage !== 'tender') return false;
  const status = record.status?.toLowerCase() ?? '';
  if (/closed|cancelled|canceled|withdrawn|complete|awarded|modified/.test(status)) return false;
  if (/active|open/.test(status)) return true;
  if (!record.deadlineDate) return false;
  return new Date(record.deadlineDate).getTime() >= now.getTime();
}

function addCandidate(
  records: Map<string, ContractRecord>,
  record: ContractRecord | null,
  excludedKeys: ReadonlySet<string>,
): void {
  if (!record || excludedKeys.has(record.recordKey)) return;
  records.set(record.recordKey, chooseNewerRecord(records.get(record.recordKey), record));
}

function orderedRecords(records: Map<string, ContractRecord>, limit: number): ContractRecord[] {
  const timestamp = (record: ContractRecord): number => new Date(
    record.lastModifiedDate ?? record.publishedDate ?? record.scrapedAt,
  ).getTime();
  return [...records.values()]
    .sort((left, right) => timestamp(right) - timestamp(left))
    .slice(0, limit);
}

function ukStage(release: UkOcdsRelease): string {
  const tags = (release.tag ?? []).map((tag) => tag.toLowerCase());
  if (tags.some((tag) => tag.includes('tender'))) return 'tender';
  if (tags.some((tag) => tag.includes('award'))) return 'award';
  if (tags.some((tag) => tag.includes('contract'))) return 'contract';
  if (tags.some((tag) => tag.includes('planning'))) return 'planning';
  return tags[0] ?? 'notice';
}

export function normalizeUkRelease(
  release: UkOcdsRelease,
  keyword: string | null,
  scrapedAt = new Date().toISOString(),
): ContractRecord | null {
  const tender = release.tender;
  const title = truncateText(tender?.title, 500);
  const contractId = truncateText(release.ocid ?? release.id ?? tender?.id, 500);
  if (!title || !contractId) return null;

  const buyer = release.parties?.find((party) => party.roles?.some((role) => role.toLowerCase() === 'buyer'));
  const buyerAddress = buyer?.address;
  const deliveryAddress = tender?.items?.flatMap((item) => item.deliveryAddresses ?? [])[0];
  const locationAddress = buyerAddress?.countryName ? buyerAddress : (deliveryAddress ?? buyerAddress);
  const classification = tender?.classification;
  const publishedDate = normalizeDateTime(tender?.datePublished ?? release.date);
  const lastModifiedDate = normalizeDateTime(release.date ?? tender?.datePublished);
  const amount = contractValueOrNull(tender?.value?.amount);
  const releaseId = truncateText(release.id ?? contractId, 500) ?? contractId;

  return {
    source: 'uk_contracts_finder',
    keyword,
    recordKey: stableRecordKey('uk_contracts_finder', contractId),
    contractId,
    title,
    buyerName: truncateText(buyer?.name, 500),
    buyerCountry: truncateText(locationAddress?.countryName, 200),
    buyerRegion: truncateText(locationAddress?.region ?? locationAddress?.locality, 200),
    noticeType: truncateText(release.tag?.join(', '), 200),
    stage: ukStage(release),
    procurementMethod: truncateText(tender?.procurementMethodDetails ?? tender?.procurementMethod, 300),
    contractValue: amount,
    currency: amount === null ? null : truncateText(tender?.value?.currency, 10),
    publishedDate,
    lastModifiedDate,
    deadlineDate: normalizeDateTime(tender?.tenderPeriod?.endDate, { dateOnlyAsEndOfDay: true }),
    status: truncateText(tender?.status, 100),
    classificationCodes: compactCodes(
      classification ? `${classification.scheme ?? 'CPV'}:${classification.id ?? ''} ${classification.description ?? ''}` : null,
      ...(tender?.additionalClassifications ?? []).map((item) => `${item.scheme ?? 'CPV'}:${item.id ?? ''} ${item.description ?? ''}`),
    ),
    description: redactSensitiveText(tender?.description),
    matchedFields: [],
    matchReason: null,
    fitScore: 0,
    fitReason: 'Not scored yet.',
    redFlags: [],
    recommendedAction: 'monitor',
    contractUrl: `https://www.contractsfinder.service.gov.uk/Notice/${encodeURIComponent(releaseId)}`,
    scrapedAt,
  };
}

function officialUkNextUrl(value: unknown, currentUrl: string): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const resolved = new URL(text, currentUrl).toString();
  if (!isOfficialSourceUrl('uk_contracts_finder', resolved)) {
    throw new Error('UK Contracts Finder returned a non-official pagination URL.');
  }
  return resolved;
}

async function scrapeUk(options: SourceScrapeOptions): Promise<ContractRecord[]> {
  const { input, keyword, limit, excludedKeys } = options;
  const fetcher = options.fetcher ?? fetchJson;
  const now = options.now ?? new Date();
  const firstUrl = new URL('https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search');
  firstUrl.searchParams.set('publishedFrom', input.dateFrom);
  firstUrl.searchParams.set('publishedTo', input.dateTo);
  if (input.noticeStatus === 'active') firstUrl.searchParams.set('stages', 'tender');
  firstUrl.searchParams.set('limit', '100');

  const records = new Map<string, ContractRecord>();
  const visited = new Set<string>();
  const maxPages = Math.min(25, Math.max(5, Math.ceil(limit / 100) + 4));
  let nextUrl: string | null = firstUrl.toString();

  for (let page = 1; page <= maxPages && nextUrl; page += 1) {
    if (visited.has(nextUrl)) throw new Error('UK Contracts Finder pagination repeated a page URL.');
    visited.add(nextUrl);
    const data = await fetcher<UkSearchResponse>(nextUrl, {}, {
      timeoutMs: 20_000,
      maxAttempts: 3,
      minIntervalMs: SOURCE_PACING_MS.uk_contracts_finder,
    });
    if (!data || typeof data !== 'object' || !Array.isArray(data.releases)) {
      throw new Error('UK Contracts Finder returned an unexpected response shape.');
    }

    for (const release of data.releases) {
      const normalized = normalizeUkRelease(release, keyword, now.toISOString());
      if (input.noticeStatus === 'active' && normalized && !isActiveTender(normalized, now)) continue;
      addCandidate(records, normalized ? withFilters(normalized, keyword, input.country) : null, excludedKeys);
    }
    if (records.size >= limit) break;
    nextUrl = officialUkNextUrl(data.links?.next, nextUrl);
  }
  return orderedRecords(records, limit);
}

function tedValue(notice: TedNotice): { amount: number | null; currency: string | null } {
  const procurementValue = notice['estimated-value-proc'];
  if (procurementValue && typeof procurementValue === 'object' && !Array.isArray(procurementValue)) {
    const amount = contractValueOrNull(procurementValue.value);
    return { amount, currency: amount === null ? null : truncateText(procurementValue.currency, 10) };
  }
  const lotValue = asArray(notice['estimated-value-lot'])[0] as { value?: unknown; currency?: unknown } | undefined;
  if (lotValue && typeof lotValue === 'object') {
    const amount = contractValueOrNull(lotValue.value);
    return {
      amount,
      currency: amount === null ? null : truncateText(lotValue.currency ?? firstText(notice['estimated-value-cur-lot']), 10),
    };
  }
  const amount = contractValueOrNull(procurementValue ?? notice['estimated-value-lot']);
  return {
    amount,
    currency: amount === null ? null : truncateText(firstText(notice['estimated-value-cur-proc'] ?? notice['estimated-value-cur-lot']), 10),
  };
}

function tedStage(notice: TedNotice): string {
  const formType = preferredText(notice['form-type'])?.toLowerCase();
  if (formType === 'competition') return 'tender';
  if (formType === 'result') return 'award';
  if (formType === 'cont-modif') return 'contract_modification';
  return formType ?? 'notice';
}

function tedStatus(notice: TedNotice, stage: string, deadlineDate: string | null, now: Date): string {
  if (stage === 'award') return 'awarded';
  if (stage === 'contract_modification') return 'modified';
  const terminationValue = notice['competition-termination-proc'];
  const termination = preferredText(terminationValue)?.toLowerCase();
  if (terminationValue === true || (termination && !['false', '0', 'no'].includes(termination))) return 'cancelled';
  if (!deadlineDate) return 'unknown';
  return new Date(deadlineDate).getTime() >= now.getTime() ? 'active' : 'closed';
}

export function normalizeTedNotice(
  notice: TedNotice,
  keyword: string | null,
  now = new Date(),
): ContractRecord | null {
  const title = truncateText(preferredText(notice['notice-title']), 500);
  const contractId = truncateText(notice['publication-number'], 500);
  if (!title || !contractId) return null;
  const value = tedValue(notice);
  const publishedDate = normalizeDateTime(notice['publication-date']);
  const deadlineDate = latestDeadlineDateTime(
    notice['deadline-receipt-tender-date-lot'] ?? notice['deadline-receipt-request-date-lot'],
  );
  const lastModifiedDate = latestDateTime(notice['change-procurement-documents-date']) ?? publishedDate;
  const stage = tedStage(notice);
  const fallbackUrl = `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(contractId)}`;

  return {
    source: 'ted',
    keyword,
    recordKey: stableRecordKey('ted', contractId),
    contractId,
    title,
    buyerName: truncateText(preferredText(notice['buyer-name']), 500),
    buyerCountry: truncateText(preferredText(notice['buyer-country'] ?? notice['place-of-performance-country']), 200),
    buyerRegion: null,
    noticeType: truncateText(
      preferredText(notice['notice-type']) ?? preferredText(notice['notice-subtype']) ?? preferredText(notice['contract-nature']),
      200,
    ),
    stage,
    procurementMethod: truncateText(preferredText(notice['procedure-type']), 300),
    contractValue: value.amount,
    currency: value.currency,
    publishedDate,
    lastModifiedDate,
    deadlineDate,
    status: tedStatus(notice, stage, deadlineDate, now),
    classificationCodes: compactCodes(notice['classification-cpv']),
    description: redactSensitiveText(preferredText(notice['description-proc'])),
    matchedFields: [],
    matchReason: null,
    fitScore: 0,
    fitReason: 'Not scored yet.',
    redFlags: [],
    recommendedAction: 'monitor',
    contractUrl: officialUrl('ted', notice.links?.html?.ENG ?? notice.links?.html?.eng, fallbackUrl),
    scrapedAt: now.toISOString(),
  };
}

async function scrapeTed(options: SourceScrapeOptions): Promise<ContractRecord[]> {
  const { input, keyword, limit, excludedKeys } = options;
  const fetcher = options.fetcher ?? fetchJson;
  const now = options.now ?? new Date();
  const fields = [
    'publication-number', 'notice-title', 'form-type', 'notice-type', 'notice-subtype',
    'competition-termination-proc', 'buyer-name', 'buyer-country',
    'publication-date', 'change-procurement-documents-date', 'deadline-receipt-tender-date-lot',
    'deadline-receipt-request-date-lot', 'procedure-type', 'contract-nature',
    'estimated-value-proc', 'estimated-value-cur-proc', 'estimated-value-lot',
    'estimated-value-cur-lot', 'description-proc', 'classification-cpv',
  ];
  const records = new Map<string, ContractRecord>();
  const pageSize = 250;
  const maxPages = Math.min(20, Math.max(5, Math.ceil(limit / pageSize) + 4));
  const fingerprints = new Set<string>();

  for (let page = 1; page <= maxPages; page += 1) {
    const body = {
      query: `publication-date >= ${input.dateFrom.replace(/-/g, '')} AND publication-date <= ${input.dateTo.replace(/-/g, '')}`,
      page,
      limit: pageSize,
      fields,
    };
    const data = await fetcher<{ notices?: TedNotice[]; totalNoticeCount?: number }>(
      'https://api.ted.europa.eu/v3/notices/search',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      { timeoutMs: 25_000, maxAttempts: 3, minIntervalMs: SOURCE_PACING_MS.ted },
    );
    if (!data || typeof data !== 'object' || !Array.isArray(data.notices)) {
      throw new Error('EU TED returned an unexpected response shape.');
    }
    const notices = data.notices;
    const fingerprint = notices.map((notice) => normalizeText(notice['publication-number'])).filter(Boolean).join('|');
    if (fingerprint && fingerprints.has(fingerprint)) throw new Error('EU TED pagination repeated a result page.');
    if (fingerprint) fingerprints.add(fingerprint);

    for (const notice of notices) {
      const normalized = normalizeTedNotice(notice, keyword, now);
      if (input.noticeStatus === 'active' && normalized && !isActiveTender(normalized, now)) continue;
      addCandidate(records, normalized ? withFilters(normalized, keyword, input.country) : null, excludedKeys);
    }
    if (records.size >= limit || notices.length < pageSize) break;
  }
  return orderedRecords(records, limit);
}

function toSamDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${month}/${day}/${year}`;
}

function samStatus(item: SamOpportunity): string {
  if (item.award) return 'awarded';
  if (item.active === true || /^yes|active$/i.test(String(item.active ?? ''))) return 'active';
  if (item.active === false || /^no|inactive$/i.test(String(item.active ?? ''))) return 'closed';
  return truncateText(item.active, 100) ?? 'unknown';
}

export function normalizeSamOpportunity(
  item: SamOpportunity,
  keyword: string | null,
  scrapedAt = new Date().toISOString(),
): ContractRecord | null {
  const title = truncateText(item.title, 500);
  const contractId = truncateText(item.noticeId ?? item.solicitationNumber, 500);
  if (!title || !contractId) return null;
  const place = item.placeOfPerformance;
  const awardAmount = contractValueOrNull(item.award?.amount);
  const fallbackUrl = `https://sam.gov/opp/${encodeURIComponent(contractId)}/view`;
  const rawDescription = normalizeText(item.description);

  return {
    source: 'sam_gov',
    keyword,
    recordKey: stableRecordKey('sam_gov', contractId),
    contractId,
    title,
    buyerName: truncateText(item.fullParentPathName ?? item.subTier ?? item.department, 500),
    buyerCountry: truncateText(place?.country?.name ?? 'United States', 200),
    buyerRegion: truncateText(place?.state?.name ?? place?.city?.state?.name ?? place?.city?.name, 200),
    noticeType: truncateText(item.type ?? item.baseType, 200),
    stage: item.award ? 'award' : 'tender',
    procurementMethod: null,
    contractValue: awardAmount,
    currency: awardAmount === null ? null : 'USD',
    publishedDate: normalizeDateTime(item.postedDate),
    lastModifiedDate: normalizeDateTime(item.postedDate),
    deadlineDate: normalizeDateTime(item.responseDeadLine ?? item.archiveDate, { dateOnlyAsEndOfDay: true }),
    status: samStatus(item),
    classificationCodes: compactCodes(
      item.naicsCode ? `NAICS:${item.naicsCode}` : null,
      item.classificationCode ? `PSC:${item.classificationCode}` : null,
    ),
    description: rawDescription && /^https?:\/\//i.test(rawDescription) ? null : redactSensitiveText(rawDescription),
    matchedFields: [],
    matchReason: null,
    fitScore: 0,
    fitReason: 'Not scored yet.',
    redFlags: [],
    recommendedAction: 'monitor',
    contractUrl: officialUrl('sam_gov', item.uiLink, fallbackUrl),
    scrapedAt,
  };
}

async function scrapeSam(options: SourceScrapeOptions): Promise<ContractRecord[]> {
  const { input, keyword, limit, excludedKeys } = options;
  const fetcher = options.fetcher ?? fetchJson;
  const now = options.now ?? new Date();
  if (!input.samApiKey) throw new Error('SAM.gov API key is missing.');

  const records = new Map<string, ContractRecord>();
  const pageSize = Math.min(100, Math.max(10, limit * 3));
  const maxPages = Math.min(20, Math.max(5, Math.ceil(limit / pageSize) + 4));
  let offset = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL('https://api.sam.gov/opportunities/v2/search');
    url.searchParams.set('api_key', input.samApiKey);
    url.searchParams.set('postedFrom', toSamDate(input.dateFrom));
    url.searchParams.set('postedTo', toSamDate(input.dateTo));
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));
    if (keyword) url.searchParams.set('title', keyword);
    if (input.noticeStatus === 'active') url.searchParams.set('status', 'active');
    const stateFilter = input.country && /^[A-Z]{2}$/i.test(input.country) ? input.country.toUpperCase() : null;
    if (stateFilter) url.searchParams.set('state', stateFilter);

    const data = await fetcher<SamSearchResponse>(url.toString(), {}, {
      timeoutMs: 25_000,
      maxAttempts: 3,
      minIntervalMs: SOURCE_PACING_MS.sam_gov,
    });
    if (!data || typeof data !== 'object' || !Array.isArray(data.opportunitiesData)) {
      throw new Error('SAM.gov returned an unexpected response shape.');
    }
    if (data.totalRecords !== undefined
      && (!Number.isFinite(data.totalRecords) || data.totalRecords < 0)) {
      throw new Error('SAM.gov returned an invalid totalRecords value.');
    }

    for (const item of data.opportunitiesData) {
      const normalized = normalizeSamOpportunity(item, keyword, now.toISOString());
      if (input.noticeStatus === 'active' && normalized && !isActiveTender(normalized, now)) continue;
      addCandidate(
        records,
        normalized ? withFilters(normalized, keyword, stateFilter ? null : input.country) : null,
        excludedKeys,
      );
    }
    if (records.size >= limit || data.opportunitiesData.length < pageSize) break;
    offset += data.opportunitiesData.length;
    if (data.totalRecords !== undefined && offset >= data.totalRecords) break;
  }
  return orderedRecords(records, limit);
}

export async function scrapeSource(
  source: SourceName,
  options: SourceScrapeOptions,
): Promise<ContractRecord[]> {
  if (source === 'uk_contracts_finder') return scrapeUk(options);
  if (source === 'ted') return scrapeTed(options);
  return scrapeSam(options);
}
