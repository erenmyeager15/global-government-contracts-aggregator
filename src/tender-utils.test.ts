import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContractRecord } from './types.js';
import { keywordMatch, latestDateTime, normalizeDateTime, stableRecordKey } from './tender-utils.js';

function record(overrides: Partial<ContractRecord> = {}): ContractRecord {
  return {
    source: 'uk_contracts_finder',
    keyword: 'cybersecurity',
    recordKey: 'uk_contracts_finder:ocds-test',
    contractId: 'ocds-test',
    title: 'Managed network services',
    buyerName: 'Example Council',
    buyerCountry: 'United Kingdom',
    buyerRegion: 'London',
    noticeType: 'tender',
    stage: 'tender',
    procurementMethod: 'Open procedure',
    contractValue: null,
    currency: null,
    publishedDate: '2026-07-06T00:00:00.000Z',
    lastModifiedDate: '2026-07-06T10:00:00.000Z',
    deadlineDate: '2026-07-31T23:59:59.999Z',
    status: 'active',
    classificationCodes: ['CPV:72000000 IT services'],
    description: 'Supply a cybersecurity monitoring platform.',
    matchedFields: ['description'],
    matchReason: 'Keyword "cybersecurity" matched description.',
    contractUrl: 'https://example.com/tender',
    scrapedAt: '2026-07-06T11:00:00.000Z',
    ...overrides,
  };
}

test('normalizes date-only deadlines to the end of the UTC day', () => {
  assert.equal(
    normalizeDateTime('2026-07-31', { dateOnlyAsEndOfDay: true }),
    '2026-07-31T23:59:59.999Z',
  );
});

test('keeps publication dates at the start of a date-only UTC day', () => {
  assert.equal(normalizeDateTime('2026-07-06'), '2026-07-06T00:00:00.000Z');
});

test('preserves exact timestamps', () => {
  assert.equal(
    normalizeDateTime('2026-07-31T12:30:00+01:00', { dateOnlyAsEndOfDay: true }),
    '2026-07-31T11:30:00.000Z',
  );
});

test('selects the latest supplied modification date', () => {
  assert.equal(
    latestDateTime(['2026-07-03', '2026-07-06', 'invalid']),
    '2026-07-06T00:00:00.000Z',
  );
});

test('builds a source-scoped stable record key', () => {
  assert.equal(
    stableRecordKey('ted', '123456-2026'),
    'ted:123456-2026',
  );
});

test('prioritizes description when explaining keyword matches', () => {
  const result = keywordMatch(record(), 'cybersecurity');
  assert.equal(result.matched, true);
  assert.deepEqual(result.matchedFields, ['description']);
  assert.equal(result.matchReason, 'Keyword "cybersecurity" matched description.');
});

test('reports every matching field in priority order', () => {
  const result = keywordMatch(record({
    title: 'Cybersecurity monitoring services',
    classificationCodes: ['CPV:72000000 Cybersecurity services'],
  }), 'cybersecurity');

  assert.deepEqual(result.matchedFields, ['description', 'title', 'classificationCodes']);
});
