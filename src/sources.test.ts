import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsonFetcher } from './http.js';
import {
  normalizeSamOpportunity,
  normalizeTedNotice,
  normalizeUkRelease,
  normalizeUsaSpendingAward,
  scrapeSource,
} from './sources.js';
import type { NormalizedInput, UkOcdsRelease } from './types.js';

function input(overrides: Partial<NormalizedInput> = {}): NormalizedInput {
  return {
    sources: ['uk_contracts_finder'],
    keywords: [],
    dateFrom: '2026-07-01',
    dateTo: '2026-07-14',
    country: null,
    noticeStatus: 'active',
    maxResults: 10,
    samApiKey: null,
    decisionProfile: {
      preferredKeywords: [],
      preferredRegions: [],
      preferredCategories: [],
      excludedKeywords: [],
      minimumContractValue: null,
      minimumValueCurrency: null,
      minimumDaysToDeadline: 7,
    },
    trackChanges: true,
    monitorName: 'default',
    observationHistoryLimit: 12,
    ...overrides,
  };
}

test('normalizes TED calendar dates that include a timezone offset', () => {
  const record = normalizeTedNotice({
    'publication-number': '449208-2026',
    'publication-date': '2026-07-01+02:00',
    'notice-title': { eng: 'Server framework' },
    'form-type': 'competition',
    'deadline-receipt-tender-date-lot': '2026-07-31+02:00',
  }, null, new Date('2026-07-14T00:00:00.000Z'));
  assert.equal(record?.publishedDate, '2026-07-01T00:00:00.000Z');
  assert.equal(record?.deadlineDate, '2026-07-31T23:59:59.999Z');
  assert.equal(record?.status, 'active');
});

test('uses the latest deadline across TED lots', () => {
  const record = normalizeTedNotice({
    'publication-number': '449209-2026',
    'publication-date': '2026-07-01+02:00',
    'notice-title': { eng: 'Multi-lot framework' },
    'form-type': 'competition',
    'deadline-receipt-tender-date-lot': ['2026-07-20+02:00', '2026-08-05+02:00'],
  }, null, new Date('2026-07-14T00:00:00.000Z'));
  assert.equal(record?.deadlineDate, '2026-08-05T23:59:59.999Z');
});

test('redacts contact details from UK descriptions and creates an official URL', () => {
  const record = normalizeUkRelease({
    ocid: 'ocds-test',
    id: 'release-id',
    date: '2026-07-10T10:00:00Z',
    tag: ['tender'],
    tender: {
      title: 'Cloud services',
      description: 'Email bids@example.com or call +44 20 1234 5678.',
      status: 'active',
      tenderPeriod: { endDate: '2026-08-01' },
    },
  }, null, '2026-07-14T00:00:00.000Z');
  assert.match(record?.description ?? '', /\[redacted email\]/);
  assert.match(record?.description ?? '', /\[redacted phone\]/);
  assert.equal(record?.contractUrl, 'https://www.contractsfinder.service.gov.uk/Notice/release-id');
});

test('does not expose SAM description API links as tender descriptions', () => {
  const record = normalizeSamOpportunity({
    noticeId: 'sam-id',
    title: 'Cybersecurity services',
    postedDate: '2026-07-10',
    active: true,
    description: 'https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=sam-id',
    uiLink: 'https://evil.example/sam-id',
  }, 'cybersecurity', '2026-07-14T00:00:00.000Z');
  assert.equal(record?.description, null);
  assert.equal(record?.contractUrl, 'https://sam.gov/opp/sam-id/view');
  assert.equal(record?.status, 'active');
});

test('normalizes a USAspending contract award with recipient and performance dates', () => {
  const record = normalizeUsaSpendingAward({
    generated_internal_id: 'CONT_AWD_123',
    'Award ID': 'FA1234-26-C-0001',
    'Recipient Name': 'Example Cybersecurity Inc.',
    'Award Amount': 1250000,
    'Awarding Agency': 'Department of Homeland Security',
    'Awarding Sub Agency': 'Cybersecurity and Infrastructure Security Agency',
    'Start Date': '2026-07-01',
    'End Date': '2027-06-30',
    Description: 'Security operations support. Email buyer@example.gov.',
    'Last Modified Date': '2026-07-12',
    'Base Obligation Date': '2026-07-01',
    'Contract Award Type': 'Definitive Contract',
    'Place of Performance State Code': 'VA',
    'Place of Performance Country Code': 'USA',
    'NAICS Code': '541512',
    'NAICS Description': 'Computer Systems Design Services',
    'PSC Code': 'D310',
    'PSC Description': 'Cyber Security and Data Backup',
  }, 'cybersecurity', '2026-07-14T00:00:00.000Z');
  assert.equal(record?.source, 'usaspending_awards');
  assert.equal(record?.recipientName, 'Example Cybersecurity Inc.');
  assert.equal(record?.stage, 'award');
  assert.equal(record?.contractValue, 1250000);
  assert.equal(record?.currency, 'USD');
  assert.equal(record?.performanceEndDate, '2027-06-30T23:59:59.999Z');
  assert.match(record?.description ?? '', /\[redacted email\]/);
  assert.equal(record?.contractUrl, 'https://www.usaspending.gov/award/CONT_AWD_123');
});

test('queries USAspending without an API key and returns matching awards', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return {
      results: [{
        generated_internal_id: 'CONT_AWD_456',
        'Award ID': 'FA1234-26-C-0002',
        'Recipient Name': 'Example Software LLC',
        'Award Amount': 500000,
        'Awarding Agency': 'Department of Defense',
        'Start Date': '2026-07-05',
        'End Date': '2027-07-04',
        Description: 'Cloud software engineering services',
        'Last Modified Date': '2026-07-12',
        'Base Obligation Date': '2026-07-05',
        'Place of Performance Country Code': 'USA',
      }],
      page_metadata: { hasNext: false },
    };
  }) as JsonFetcher;
  const records = await scrapeSource('usaspending_awards', {
    input: input({ sources: ['usaspending_awards'], country: 'United States' }),
    keyword: 'software',
    limit: 1,
    excludedKeys: new Set(),
    fetcher,
    now: new Date('2026-07-14T00:00:00.000Z'),
  });
  assert.equal(records.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.usaspending.gov/api/v2/search/spending_by_award/');
  const body = JSON.parse(String(requests[0].init?.body)) as { filters: { keywords: string[]; award_type_codes: string[] } };
  assert.deepEqual(body.filters.keywords, ['software']);
  assert.deepEqual(body.filters.award_type_codes, ['A', 'B', 'C', 'D']);
  assert.doesNotMatch(JSON.stringify(requests[0]), /api[_-]?key/i);
});

test('keeps only the newest UK amendment for a stable record key', async () => {
  const release = (title: string, date: string): UkOcdsRelease => ({
    ocid: 'ocds-same',
    id: `release-${date}`,
    date,
    tag: ['tender'],
    tender: {
      title,
      status: 'active',
      tenderPeriod: { endDate: '2026-08-01' },
    },
  });
  const fetcher = (async () => ({
    releases: [
      release('Older title', '2026-07-01T10:00:00Z'),
      release('Amended title', '2026-07-10T10:00:00Z'),
    ],
    links: {},
  })) as JsonFetcher;

  const records = await scrapeSource('uk_contracts_finder', {
    input: input(),
    keyword: null,
    limit: 1,
    excludedKeys: new Set(),
    fetcher,
    now: new Date('2026-07-14T00:00:00.000Z'),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'Amended title');
  assert.equal(records[0].lastModifiedDate, '2026-07-10T10:00:00.000Z');
});

test('rejects a non-official Contracts Finder pagination URL', async () => {
  const fetcher = (async () => ({ releases: [], links: { next: 'https://evil.example/next' } })) as JsonFetcher;
  await assert.rejects(
    scrapeSource('uk_contracts_finder', {
      input: input(),
      keyword: null,
      limit: 1,
      excludedKeys: new Set(),
      fetcher,
      now: new Date('2026-07-14T00:00:00.000Z'),
    }),
    /non-official pagination URL/,
  );
});
