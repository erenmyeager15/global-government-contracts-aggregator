import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsonFetcher } from './http.js';
import { normalizeSamOpportunity, normalizeTedNotice, normalizeUkRelease, scrapeSource } from './sources.js';
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
