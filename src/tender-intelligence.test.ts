import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContractRecord, DecisionProfile, NormalizedInput } from './types.js';
import {
  applyTenderIntelligence,
  buildTenderReport,
  normalizeDecisionProfile,
} from './tender-intelligence.js';

function record(overrides: Partial<ContractRecord> = {}): ContractRecord {
  return {
    source: 'uk_contracts_finder',
    keyword: 'software',
    recordKey: 'uk_contracts_finder:ocds-test',
    contractId: 'ocds-test',
    title: 'Cloud software support services',
    buyerName: 'Example Council',
    buyerCountry: 'United Kingdom',
    buyerRegion: 'London',
    noticeType: 'tender',
    stage: 'tender',
    procurementMethod: 'Open procedure',
    contractValue: 250000,
    currency: 'GBP',
    publishedDate: '2026-07-01T00:00:00.000Z',
    lastModifiedDate: '2026-07-06T10:00:00.000Z',
    deadlineDate: '2026-08-10T23:59:59.999Z',
    status: 'active',
    classificationCodes: ['CPV:72000000 IT services'],
    description: 'Provide cloud software and managed support services.',
    matchedFields: ['description', 'title'],
    matchReason: 'Keyword "software" matched description, title.',
    fitScore: 0,
    fitReason: 'Not scored yet.',
    redFlags: [],
    recommendedAction: 'monitor',
    contractUrl: 'https://example.com/tender',
    scrapedAt: '2026-07-11T08:00:00.000Z',
    ...overrides,
  };
}

function profile(overrides: Partial<DecisionProfile> = {}): DecisionProfile {
  return {
    preferredKeywords: ['software'],
    preferredRegions: ['London'],
    preferredCategories: ['72000000'],
    excludedKeywords: [],
    minimumContractValue: 100000,
    minimumValueCurrency: 'GBP',
    minimumDaysToDeadline: 7,
    ...overrides,
  };
}

test('normalizes a profile and falls back to search keywords', () => {
  const normalized = normalizeDecisionProfile({ minimumDaysToDeadline: 14 }, ['software']);
  assert.deepEqual(normalized.preferredKeywords, ['software']);
  assert.equal(normalized.minimumDaysToDeadline, 14);
  assert.equal(normalized.minimumContractValue, null);
});

test('a strong active opportunity is ranked for immediate review', () => {
  const scored = applyTenderIntelligence(record(), profile(), new Date('2026-07-11T00:00:00.000Z'));
  assert.equal(scored.fitScore, 100);
  assert.equal(scored.recommendedAction, 'review_now');
  assert.deepEqual(scored.redFlags, []);
  assert.match(scored.fitReason, /preferred region matched: London/);
});

test('an expired opportunity is blocked even when content fit is strong', () => {
  const scored = applyTenderIntelligence(record({
    deadlineDate: '2026-07-01T23:59:59.999Z',
    status: 'closed',
  }), profile(), new Date('2026-07-11T00:00:00.000Z'));
  assert.equal(scored.recommendedAction, 'skip');
  assert.ok(scored.redFlags.includes('Deadline has passed.'));
});

test('excluded keywords force a skip recommendation', () => {
  const scored = applyTenderIntelligence(record({ description: 'Cloud software support for defence systems.' }), profile({
    excludedKeywords: ['defence'],
  }), new Date('2026-07-11T00:00:00.000Z'));
  assert.equal(scored.recommendedAction, 'skip');
  assert.match(scored.redFlags.join(' '), /Excluded keyword matched: defence/);
});

test('minimum values are not compared across currencies', () => {
  const scored = applyTenderIntelligence(record({ currency: 'EUR' }), profile(), new Date('2026-07-11T00:00:00.000Z'));
  assert.match(scored.redFlags.join(' '), /differs from profile currency GBP/);
  assert.doesNotMatch(scored.fitReason, /value meets minimum/);
});

test('a minimum value without currency is not applied', () => {
  const scored = applyTenderIntelligence(record(), profile({ minimumValueCurrency: null }), new Date('2026-07-11T00:00:00.000Z'));
  assert.match(scored.redFlags.join(' '), /Minimum value currency is not configured/);
  assert.doesNotMatch(scored.fitReason, /value meets minimum/);
});

test('the report sorts the highest fit opportunity first', () => {
  const strong = applyTenderIntelligence(record(), profile(), new Date('2026-07-11T00:00:00.000Z'));
  const weak = applyTenderIntelligence(record({
    recordKey: 'uk_contracts_finder:weak',
    contractId: 'weak',
    title: 'Office furniture supply',
    description: 'Supply desks and chairs.',
    buyerRegion: 'Manchester',
    classificationCodes: ['CPV:39100000 Furniture'],
    contractValue: 50000,
    contractUrl: 'https://example.com/weak',
  }), profile(), new Date('2026-07-11T00:00:00.000Z'));
  const input: NormalizedInput = {
    sources: ['uk_contracts_finder'],
    keywords: ['software'],
    dateFrom: '2026-07-01',
    dateTo: '2026-07-11',
    country: null,
    noticeStatus: 'active',
    maxResults: 2,
    samApiKey: null,
    decisionProfile: profile(),
  };
  const report = buildTenderReport([weak, strong], input);
  assert.ok(report.indexOf('Cloud software support services') < report.indexOf('Office furniture supply'));
  assert.match(report, /Scores are deterministic triage signals/);
});
