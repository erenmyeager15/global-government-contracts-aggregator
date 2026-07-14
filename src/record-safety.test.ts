import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeRecord, redactSensitiveText } from './record-safety.js';
import type { ContractRecord } from './types.js';

function record(overrides: Partial<ContractRecord> = {}): ContractRecord {
  return {
    source: 'ted',
    keyword: null,
    recordKey: 'ted:123-2026',
    contractId: '123-2026',
    title: 'Software services',
    buyerName: 'Example authority',
    buyerCountry: 'Germany',
    buyerRegion: null,
    noticeType: 'competition',
    stage: 'tender',
    procurementMethod: null,
    contractValue: null,
    currency: null,
    publishedDate: '2026-07-01T00:00:00.000Z',
    lastModifiedDate: '2026-07-01T00:00:00.000Z',
    deadlineDate: '2026-07-31T23:59:59.999Z',
    status: 'active',
    classificationCodes: [],
    description: 'Public tender description.',
    matchedFields: [],
    matchReason: null,
    fitScore: 0,
    fitReason: 'Not scored yet.',
    redFlags: [],
    recommendedAction: 'monitor',
    contractUrl: 'https://ted.europa.eu/en/notice/-/detail/123-2026',
    scrapedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

test('accepts a normalized record with an official source URL', () => {
  assert.equal(assertSafeRecord(record()).recordKey, 'ted:123-2026');
});
test('rejects a source URL hosted outside the official domain', () => {
  assert.throws(() => assertSafeRecord(record({ contractUrl: 'https://evil.example/tender' })), /non-official/);
});

test('redacts public contact details before dataset validation', () => {
  const redacted = redactSensitiveText('Contact jane@example.com or +44 20 1234 5678.');
  assert.equal(redacted, 'Contact [redacted email] or [redacted phone].');
});
