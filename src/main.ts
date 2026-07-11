import { Actor, log } from 'apify';
import type { ActorInput, ContractRecord, NormalizedInput, SamOpportunity, SourceName, TedNotice, UkOcdsRelease } from './types.js';
import {
  containsSearchText,
  keywordMatch,
  latestDateTime,
  normalizeDateTime,
  normalizeText,
  stableRecordKey,
} from './tender-utils.js';
import { applyTenderIntelligence, buildTenderReport, normalizeDecisionProfile } from './tender-intelligence.js';

const DEFAULT_SOURCES: SourceName[] = ['uk_contracts_finder', 'ted'];
const CONTRACT_EVENT = 'contract-scraped';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultDateFrom(): string {
  return isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
}

function redactSensitiveText(value: string | null): string | null {
  if (!value) return null;
  return normalizeText(
    value
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
      .replace(/(?<![\w-])(?:\+?\d[\d\s().-]{9,13}\d)(?![\w-])/g, '[redacted phone]'),
  );
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function firstText(value: unknown): string | null {
  if (!value) return null;
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
    for (const language of ['eng', 'en', 'ENG']) {
      const text = firstText(translations[language]);
      if (text) return text;
    }
  }
  return firstText(value);
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
  return amount !== null && amount > 1 ? amount : null;
}

function compactCodes(...values: unknown[]): string[] {
  const codes = new Set<string>();
  for (const value of values.flatMap(asArray)) {
    const text = normalizeText(value);
    if (text) codes.add(text);
  }
  return [...codes];
}

function normalizeInput(input: ActorInput | null): NormalizedInput {
  const sources = (input?.sources?.length ? input.sources : DEFAULT_SOURCES).filter((source): source is SourceName =>
    ['uk_contracts_finder', 'ted', 'sam_gov'].includes(source),
  );
  const keywords = (input?.keywords ?? [])
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  return {
    sources: sources.length ? [...new Set(sources)] : DEFAULT_SOURCES,
    keywords,
    dateFrom: input?.dateFrom || defaultDateFrom(),
    dateTo: input?.dateTo || isoDate(new Date()),
    country: normalizeText(input?.country),
    noticeStatus: input?.noticeStatus ?? 'active',
    maxResults: Math.min(Math.max(input?.maxResults ?? 10, 1), 1000),
    samApiKey: normalizeText(input?.samApiKey),
    decisionProfile: normalizeDecisionProfile(input?.decisionProfile, keywords),
  };
}

function matchesFilters(record: ContractRecord, keyword: string | null, country: string | null): boolean {
  const match = keywordMatch(record, keyword);
  record.matchedFields = match.matchedFields;
  record.matchReason = match.matchReason;

  if (!match.matched) return false;
  if (!containsSearchText(record, country)) return false;
  return true;
}

async function fetchJson<T>(url: string, options: RequestInit = {}, retries = 3): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 (compatible; Apify Government Contracts Aggregator/1.0)',
          ...(options.headers ?? {}),
        },
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
      return JSON.parse(text) as T;
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

function normalizeUkRelease(release: UkOcdsRelease, keyword: string | null): ContractRecord | null {
  const tender = release.tender;
  const title = normalizeText(tender?.title);
  const contractId = normalizeText(release.ocid ?? release.id ?? tender?.id);
  if (!title || !contractId) return null;

  const buyer = release.parties?.find((party) => party.roles?.includes('buyer'));
  const buyerAddress = buyer?.address;
  const deliveryAddress = tender?.items?.flatMap((item) => item.deliveryAddresses ?? [])[0];
  // Derive country and region from the SAME address (prefer the buyer's, fall back to delivery)
  // so the pair is always consistent instead of mixing buyer country with delivery region.
  const locationAddress = buyerAddress?.countryName ? buyerAddress : (deliveryAddress ?? buyerAddress);
  const classification = tender?.classification;
  const publishedDate = normalizeDateTime(tender?.datePublished ?? release.date);
  const lastModifiedDate = normalizeDateTime(release.date ?? tender?.datePublished);

  return {
    source: 'uk_contracts_finder',
    keyword,
    recordKey: stableRecordKey('uk_contracts_finder', contractId),
    contractId,
    title,
    buyerName: normalizeText(buyer?.name),
    buyerCountry: normalizeText(locationAddress?.countryName),
    buyerRegion: normalizeText(locationAddress?.region ?? locationAddress?.locality),
    noticeType: release.tag?.join(', ') ?? null,
    stage: 'tender',
    procurementMethod: normalizeText(tender?.procurementMethodDetails ?? tender?.procurementMethod),
    contractValue: contractValueOrNull(tender?.value?.amount),
    currency: contractValueOrNull(tender?.value?.amount) === null ? null : normalizeText(tender?.value?.currency),
    publishedDate,
    lastModifiedDate,
    deadlineDate: normalizeDateTime(tender?.tenderPeriod?.endDate, {
      referenceValue: publishedDate,
      dateOnlyAsEndOfDay: true,
    }),
    status: normalizeText(tender?.status),
    classificationCodes: compactCodes(
      classification ? `${classification.scheme ?? 'CPV'}:${classification.id ?? ''} ${classification.description ?? ''}` : null,
      ...(tender?.additionalClassifications ?? []).map((item) => `${item.scheme ?? 'CPV'}:${item.id ?? ''} ${item.description ?? ''}`),
    ),
    description: redactSensitiveText(normalizeText(tender?.description)),
    matchedFields: [],
    matchReason: null,
    fitScore: 0,
    fitReason: 'Not scored yet.',
    redFlags: [],
    recommendedAction: 'monitor',
    contractUrl: contractId ? `https://www.contractsfinder.service.gov.uk/Notice/${release.id ?? contractId}` : null,
    scrapedAt: new Date().toISOString(),
  };
}

async function scrapeUk(input: NormalizedInput, keyword: string | null, remaining: () => number): Promise<ContractRecord[]> {
  const records: ContractRecord[] = [];
  const firstUrl = new URL('https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search');
  firstUrl.searchParams.set('publishedFrom', input.dateFrom);
  firstUrl.searchParams.set('publishedTo', input.dateTo);
  firstUrl.searchParams.set('stages', 'tender');
  firstUrl.searchParams.set('limit', '100');

  let nextUrl: string | null = firstUrl.toString();
  const visited = new Set<string>();

  for (let page = 1; page <= 100 && nextUrl && records.length < remaining(); page += 1) {
    if (visited.has(nextUrl)) break;
    visited.add(nextUrl);
    const data: { releases?: UkOcdsRelease[]; links?: { next?: string } } = await fetchJson(nextUrl);

    for (const release of data.releases ?? []) {
      if (records.length >= remaining()) break;
      const record = normalizeUkRelease(release, keyword);
      if (record && matchesFilters(record, keyword, input.country)) records.push(record);
    }

    nextUrl = normalizeText(data.links?.next);
  }
  return records;
}

function tedValue(notice: TedNotice): { amount: number | null; currency: string | null } {
  const procValue = notice['estimated-value-proc'];
  if (procValue && typeof procValue === 'object' && !Array.isArray(procValue)) {
    return { amount: numberOrNull(procValue.value), currency: normalizeText(procValue.currency) };
  }
  const lotValue = asArray(notice['estimated-value-lot'])[0] as { value?: unknown; currency?: unknown } | undefined;
  if (lotValue && typeof lotValue === 'object') {
    return {
      amount: numberOrNull(lotValue.value),
      currency: normalizeText(lotValue.currency) ?? firstText(notice['estimated-value-cur-lot']),
    };
  }
  return {
    amount: numberOrNull(procValue ?? notice['estimated-value-lot']),
    currency: firstText(notice['estimated-value-cur-proc'] ?? notice['estimated-value-cur-lot']),
  };
}

function tedStage(notice: TedNotice): string {
  const formType = preferredText(notice['form-type']);
  if (formType === 'competition') return 'tender';
  if (formType === 'result') return 'award';
  if (formType === 'cont-modif') return 'contract_modification';
  return formType ?? 'notice';
}

function tedStatus(notice: TedNotice, stage: string, deadlineDate: string | null): string {
  if (stage === 'award') return 'awarded';
  if (stage === 'contract_modification') return 'modified';

  const terminationValue = notice['competition-termination-proc'];
  const termination = preferredText(terminationValue)?.toLowerCase();
  if (terminationValue === true || (termination && !['false', '0', 'no'].includes(termination))) return 'cancelled';
  if (!deadlineDate) return 'unknown';
  return new Date(deadlineDate).getTime() >= Date.now() ? 'active' : 'closed';
}

function normalizeTedNotice(notice: TedNotice, keyword: string | null): ContractRecord | null {
  const title = preferredText(notice['notice-title']);
  const contractId = normalizeText(notice['publication-number']);
  if (!title || !contractId) return null;
  const value = tedValue(notice);
  const htmlUrl = `https://ted.europa.eu/en/notice/-/detail/${contractId}`;
  const publishedDate = normalizeDateTime(notice['publication-date']);
  const deadlineDate = normalizeDateTime(
    preferredText(notice['deadline-receipt-tender-date-lot'] ?? notice['deadline-receipt-request-date-lot']),
    { referenceValue: publishedDate, dateOnlyAsEndOfDay: true },
  );
  const lastModifiedDate = latestDateTime(notice['change-procurement-documents-date'])
    ?? normalizeDateTime(notice['publication-date']);
  const stage = tedStage(notice);
  const status = tedStatus(notice, stage, deadlineDate);

  return {
    source: 'ted',
    keyword,
    recordKey: stableRecordKey('ted', contractId),
    contractId,
    title,
    buyerName: preferredText(notice['buyer-name']),
    buyerCountry: preferredText(notice['buyer-country'] ?? notice['place-of-performance-country']),
    buyerRegion: null,
    noticeType: preferredText(notice['notice-type'])
      ?? preferredText(notice['notice-subtype'])
      ?? preferredText(notice['contract-nature']),
    stage,
    procurementMethod: preferredText(notice['procedure-type']),
    contractValue: value.amount,
    currency: value.currency,
    publishedDate,
    lastModifiedDate,
    deadlineDate,
    status,
    classificationCodes: compactCodes(notice['classification-cpv']),
    description: redactSensitiveText(preferredText(notice['description-proc'])),
    matchedFields: [],
    matchReason: null,
    fitScore: 0,
    fitReason: 'Not scored yet.',
    redFlags: [],
    recommendedAction: 'monitor',
    contractUrl: htmlUrl,
    scrapedAt: new Date().toISOString(),
  };
}

async function scrapeTed(input: NormalizedInput, keyword: string | null, remaining: () => number): Promise<ContractRecord[]> {
  const fields = [
    'publication-number',
    'notice-title',
    'form-type',
    'notice-type',
    'notice-subtype',
    'competition-termination-proc',
    'buyer-name',
    'buyer-country',
    'publication-date',
    'change-procurement-documents-date',
    'deadline-receipt-tender-date-lot',
    'deadline-receipt-request-date-lot',
    'procedure-type',
    'contract-nature',
    'estimated-value-proc',
    'estimated-value-cur-proc',
    'estimated-value-lot',
    'estimated-value-cur-lot',
    'description-proc',
    'classification-cpv',
  ];
  const from = input.dateFrom.replace(/-/g, '');
  const records: ContractRecord[] = [];
  const pageSize = 250;
  const maxPages = 20;

  for (let page = 1; page <= maxPages && records.length < remaining(); page += 1) {
    const body = {
      query: `publication-date >= ${from} AND publication-date <= ${input.dateTo.replace(/-/g, '')}`,
      page,
      limit: pageSize,
      fields,
    };
    const data = await fetchJson<{ notices?: TedNotice[] }>('https://api.ted.europa.eu/v3/notices/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const notices = data.notices ?? [];

    for (const notice of notices) {
      if (records.length >= remaining()) break;
      const record = normalizeTedNotice(notice, keyword);
      if (input.noticeStatus === 'active' && (record?.stage !== 'tender' || record.status !== 'active')) continue;
      if (record && matchesFilters(record, keyword, input.country)) records.push(record);
    }

    if (notices.length < pageSize) break;
  }
  return records;
}

function toSamDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${month}/${day}/${year}`;
}

function normalizeSamOpportunity(item: SamOpportunity, keyword: string | null): ContractRecord | null {
  const title = normalizeText(item.title);
  const contractId = normalizeText(item.noticeId ?? item.solicitationNumber);
  if (!title || !contractId) return null;
  const place = item.placeOfPerformance;
  const awardAmount = numberOrNull(item.award?.amount);

  return {
    source: 'sam_gov',
    keyword,
    recordKey: stableRecordKey('sam_gov', contractId),
    contractId,
    title,
    buyerName: normalizeText(item.fullParentPathName ?? item.subTier ?? item.department),
    buyerCountry: normalizeText(place?.country?.name ?? 'United States'),
    buyerRegion: normalizeText(place?.state?.name ?? place?.city?.state?.name ?? place?.city?.name),
    noticeType: normalizeText(item.type ?? item.baseType),
    stage: item.award ? 'award' : 'tender',
    procurementMethod: null,
    contractValue: awardAmount,
    currency: awardAmount !== null ? 'USD' : null,
    publishedDate: normalizeDateTime(item.postedDate),
    lastModifiedDate: normalizeDateTime(item.postedDate),
    deadlineDate: normalizeDateTime(item.responseDeadLine ?? item.archiveDate, {
      referenceValue: item.postedDate,
      dateOnlyAsEndOfDay: true,
    }),
    status: normalizeText(item.active === 'Yes' ? 'active' : item.active),
    classificationCodes: compactCodes(item.naicsCode ? `NAICS:${item.naicsCode}` : null, item.classificationCode ? `PSC:${item.classificationCode}` : null),
    description: redactSensitiveText(normalizeText(item.description)),
    matchedFields: [],
    matchReason: null,
    fitScore: 0,
    fitReason: 'Not scored yet.',
    redFlags: [],
    recommendedAction: 'monitor',
    contractUrl: normalizeText(item.uiLink) ?? (contractId ? `https://sam.gov/opp/${contractId}/view` : null),
    scrapedAt: new Date().toISOString(),
  };
}

async function scrapeSam(input: NormalizedInput, keyword: string | null, remaining: () => number): Promise<ContractRecord[]> {
  if (!input.samApiKey) {
    log.warning('SAM.gov selected but samApiKey is missing; skipping SAM.gov.');
    return [];
  }

  const url = new URL('https://api.sam.gov/opportunities/v2/search');
  url.searchParams.set('api_key', input.samApiKey);
  url.searchParams.set('postedFrom', toSamDate(input.dateFrom));
  url.searchParams.set('postedTo', toSamDate(input.dateTo));
  url.searchParams.set('limit', String(Math.min(Math.max(remaining(), 1), 1000)));
  url.searchParams.set('offset', '0');
  if (keyword) url.searchParams.set('title', keyword);
  if (input.noticeStatus === 'active') url.searchParams.set('status', 'active');
  if (input.country && /^[A-Z]{2}$/i.test(input.country)) url.searchParams.set('state', input.country.toUpperCase());

  const data = await fetchJson<{ opportunitiesData?: SamOpportunity[] }>(url.toString());
  const records: ContractRecord[] = [];
  for (const item of data.opportunitiesData ?? []) {
    if (records.length >= remaining()) break;
    const record = normalizeSamOpportunity(item, keyword);
    if (record && matchesFilters(record, keyword, input.country && /^[A-Z]{2}$/i.test(input.country) ? null : input.country)) records.push(record);
  }
  return records;
}

async function pushUnique(
  records: ContractRecord[],
  seen: Set<string>,
  remaining: () => number,
  savedRecords: ContractRecord[],
): Promise<{ saved: number; stopped: boolean }> {
  let saved = 0;
  for (const record of records) {
    if (remaining() <= 0) break;
    const key = record.recordKey;
    if (seen.has(key)) continue;

    const chargeResult = await Actor.pushData(record, CONTRACT_EVENT);
    const recordWasSaved = chargeResult.chargedCount > 0 || !chargeResult.eventChargeLimitReached;
    if (recordWasSaved) {
      seen.add(key);
      savedRecords.push(record);
      saved += 1;
    }

    if (chargeResult.eventChargeLimitReached) return { saved, stopped: true };
  }
  return { saved, stopped: false };
}

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput<ActorInput>());
  const keywords = input.keywords.length ? input.keywords : [null];
  const seen = new Set<string>();
  const savedRecords: ContractRecord[] = [];
  let savedCount = 0;
  let stoppedByChargeLimit = false;
  const remaining = () => input.maxResults - savedCount;

  log.info('Starting global government contracts scrape', {
    sources: input.sources,
    keywords,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    maxResults: input.maxResults,
  });

  for (const keyword of keywords) {
    if (remaining() <= 0 || stoppedByChargeLimit) break;

    for (const source of input.sources) {
      if (remaining() <= 0 || stoppedByChargeLimit) break;
      let records: ContractRecord[] = [];

      if (source === 'uk_contracts_finder') {
        log.info('Scraping UK Contracts Finder', { keyword });
        records = await scrapeUk(input, keyword, remaining);
      } else if (source === 'ted') {
        log.info('Scraping EU TED', { keyword });
        records = await scrapeTed(input, keyword, remaining);
      } else if (source === 'sam_gov') {
        log.info('Scraping SAM.gov', { keyword });
        records = await scrapeSam(input, keyword, remaining);
      }

      records = records.map((record) => applyTenderIntelligence(record, input.decisionProfile));
      const pushResult = await pushUnique(records, seen, remaining, savedRecords);
      savedCount += pushResult.saved;
      stoppedByChargeLimit = pushResult.stopped;
      if (!stoppedByChargeLimit) {
        await new Promise((resolve) => setTimeout(resolve, 500 + Math.floor(Math.random() * 700)));
      }
    }
  }

  await Actor.setValue('TENDER_REPORT', buildTenderReport(savedRecords, input), {
    contentType: 'text/markdown; charset=utf-8',
  });

  if (stoppedByChargeLimit) {
    const message = `Stopped at the user's spending limit after ${savedCount} contract(s).`;
    await Actor.setStatusMessage(message);
    log.warning(message);
  } else {
    await Actor.setStatusMessage(`Finished with ${savedCount} unique contract(s).`);
    log.info('Government contracts scrape finished', { savedCount });
  }
} catch (error) {
  log.exception(error as Error, 'Global government contracts actor failed');
  await Actor.fail(`Failed: ${(error as Error).message}`);
}

await Actor.exit();
