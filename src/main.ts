import { Actor, log } from 'apify';
import type { ActorInput, ContractRecord, NormalizedInput, SamOpportunity, SourceName, TedNotice, UkOcdsRelease } from './types.js';

const DEFAULT_SOURCES: SourceName[] = ['uk_contracts_finder', 'ted'];
const CONTRACT_EVENT = 'contract-scraped';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultDateFrom(): string {
  return isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
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

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = normalizeText(value)?.replace(/,/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
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
    maxResults: Math.min(Math.max(input?.maxResults ?? 50, 1), 1000),
    samApiKey: normalizeText(input?.samApiKey),
  };
}

function matchesFilters(record: ContractRecord, keyword: string | null, country: string | null): boolean {
  const haystack = [
    record.title,
    record.buyerName,
    record.buyerCountry,
    record.buyerRegion,
    record.noticeType,
    record.stage,
    record.procurementMethod,
    record.description,
    ...record.classificationCodes,
  ].filter(Boolean).join(' ').toLowerCase();

  if (keyword && !haystack.includes(keyword.toLowerCase())) return false;
  if (country && !haystack.includes(country.toLowerCase())) return false;
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
  const address = buyer?.address ?? tender?.items?.[0]?.deliveryAddresses?.[0];
  const classification = tender?.classification;

  return {
    source: 'uk_contracts_finder',
    keyword,
    contractId,
    title,
    buyerName: normalizeText(buyer?.name),
    buyerCountry: normalizeText(address?.countryName),
    buyerRegion: normalizeText(address?.region ?? address?.locality),
    noticeType: release.tag?.join(', ') ?? null,
    stage: 'tender',
    procurementMethod: normalizeText(tender?.procurementMethodDetails ?? tender?.procurementMethod),
    contractValue: numberOrNull(tender?.value?.amount),
    currency: normalizeText(tender?.value?.currency),
    publishedDate: normalizeText(tender?.datePublished ?? release.date),
    deadlineDate: normalizeText(tender?.tenderPeriod?.endDate),
    status: normalizeText(tender?.status),
    classificationCodes: compactCodes(
      classification ? `${classification.scheme ?? 'CPV'}:${classification.id ?? ''} ${classification.description ?? ''}` : null,
      ...(tender?.additionalClassifications ?? []).map((item) => `${item.scheme ?? 'CPV'}:${item.id ?? ''} ${item.description ?? ''}`),
    ),
    description: normalizeText(tender?.description),
    contractUrl: contractId ? `https://www.contractsfinder.service.gov.uk/Notice/${release.id ?? contractId}` : null,
    scrapedAt: new Date().toISOString(),
  };
}

async function scrapeUk(input: NormalizedInput, keyword: string | null, remaining: () => number): Promise<ContractRecord[]> {
  const records: ContractRecord[] = [];
  const url = new URL('https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search');
  url.searchParams.set('publishedFrom', input.dateFrom);
  url.searchParams.set('publishedTo', input.dateTo);
  url.searchParams.set('stages', 'tender');
  url.searchParams.set('limit', String(Math.min(Math.max(input.maxResults * 5, 100), 1000)));

  const data = await fetchJson<{ releases?: UkOcdsRelease[] }>(url.toString());
  for (const release of data.releases ?? []) {
    if (records.length >= remaining()) break;
    const record = normalizeUkRelease(release, keyword);
    if (record && matchesFilters(record, keyword, input.country)) records.push(record);
  }
  return records;
}

function tedValue(notice: TedNotice): { amount: number | null; currency: string | null } {
  const procValue = notice['estimated-value-proc'];
  if (procValue && typeof procValue === 'object' && !Array.isArray(procValue)) {
    return { amount: numberOrNull(procValue.value), currency: normalizeText(procValue.currency) };
  }
  const lotValue = asArray(notice['estimated-value-lot'])[0] as { value?: unknown; currency?: unknown } | undefined;
  if (lotValue && typeof lotValue === 'object') return { amount: numberOrNull(lotValue.value), currency: normalizeText(lotValue.currency) };
  return { amount: numberOrNull(procValue), currency: null };
}

function normalizeTedNotice(notice: TedNotice, keyword: string | null): ContractRecord | null {
  const title = firstText(notice['notice-title']);
  const contractId = normalizeText(notice['publication-number']);
  if (!title || !contractId) return null;
  const value = tedValue(notice);
  const htmlUrl = `https://ted.europa.eu/en/notice/-/detail/${contractId}`;

  return {
    source: 'ted',
    keyword,
    contractId,
    title,
    buyerName: firstText(notice['buyer-name']),
    buyerCountry: firstText(notice['buyer-country'] ?? notice['place-of-performance-country']),
    buyerRegion: null,
    noticeType: firstText(notice['contract-nature']),
    stage: 'tender',
    procurementMethod: firstText(notice['procedure-type']),
    contractValue: value.amount,
    currency: value.currency,
    publishedDate: normalizeText(notice['publication-date']),
    deadlineDate: firstText(notice['deadline-receipt-tender-date-lot'] ?? notice['deadline-receipt-request-date-lot']),
    status: null,
    classificationCodes: compactCodes(notice['classification-cpv']),
    description: firstText(notice['description-proc']),
    contractUrl: htmlUrl,
    scrapedAt: new Date().toISOString(),
  };
}

async function scrapeTed(input: NormalizedInput, keyword: string | null, remaining: () => number): Promise<ContractRecord[]> {
  const fields = [
    'publication-number',
    'notice-title',
    'buyer-name',
    'buyer-country',
    'publication-date',
    'deadline-receipt-tender-date-lot',
    'deadline-receipt-request-date-lot',
    'procedure-type',
    'contract-nature',
    'estimated-value-proc',
    'estimated-value-lot',
    'description-proc',
    'classification-cpv',
  ];
  const from = input.dateFrom.replace(/-/g, '');
  const body = {
    query: `publication-date >= ${from}`,
    page: 1,
    limit: Math.min(Math.max(input.maxResults * 5, 100), 250),
    fields,
  };
  const data = await fetchJson<{ notices?: TedNotice[] }>('https://api.ted.europa.eu/v3/notices/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const records: ContractRecord[] = [];
  for (const notice of data.notices ?? []) {
    if (records.length >= remaining()) break;
    const record = normalizeTedNotice(notice, keyword);
    if (record && matchesFilters(record, keyword, input.country)) records.push(record);
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
    publishedDate: normalizeText(item.postedDate),
    deadlineDate: normalizeText(item.responseDeadLine ?? item.archiveDate),
    status: normalizeText(item.active === 'Yes' ? 'active' : item.active),
    classificationCodes: compactCodes(item.naicsCode ? `NAICS:${item.naicsCode}` : null, item.classificationCode ? `PSC:${item.classificationCode}` : null),
    description: normalizeText(item.description),
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

async function pushUnique(records: ContractRecord[], seen: Set<string>, remaining: () => number): Promise<number> {
  let saved = 0;
  for (const record of records) {
    if (remaining() <= 0) break;
    const key = `${record.source}:${record.contractId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await Actor.pushData(record);
    await Actor.charge({ eventName: CONTRACT_EVENT });
    saved += 1;
  }
  return saved;
}

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput<ActorInput>());
  const keywords = input.keywords.length ? input.keywords : [null];
  const seen = new Set<string>();
  let savedCount = 0;
  const remaining = () => input.maxResults - savedCount;

  log.info('Starting global government contracts scrape', {
    sources: input.sources,
    keywords,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    maxResults: input.maxResults,
  });

  for (const keyword of keywords) {
    if (remaining() <= 0) break;

    for (const source of input.sources) {
      if (remaining() <= 0) break;
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

      savedCount += await pushUnique(records, seen, remaining);
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.floor(Math.random() * 700)));
    }
  }

  log.info('Government contracts scrape finished', { savedCount });
} catch (error) {
  log.exception(error as Error, 'Global government contracts actor failed');
  throw error;
} finally {
  await Actor.exit();
}
