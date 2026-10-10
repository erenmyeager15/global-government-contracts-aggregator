import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMonitoring, monitoringRecordKey, monitoringStoreName } from './monitoring.js';
import type { ContractRecord } from './types.js';

function record(overrides: Partial<ContractRecord> = {}): ContractRecord {
  return {
    source: 'usaspending_awards',
    keyword: 'software',
    recordKey: 'usaspending_awards:abc',
    contractId: 'abc',
    title: 'Cloud software award',
    buyerName: 'Example Agency',
    recipientName: 'Example Vendor',
    buyerCountry: 'United States',
    buyerRegion: 'VA',
    noticeType: 'Definitive Contract',
    stage: 'award',
    procurementMethod: 'Definitive Contract',
    contractValue: 100000,
    currency: 'USD',
    publishedDate: '2026-07-01T00:00:00.000Z',
    lastModifiedDate: '2026-07-10T00:00:00.000Z',
    deadlineDate: null,
    performanceStartDate: '2026-07-01T00:00:00.000Z',
    performanceEndDate: '2027-06-30T23:59:59.999Z',
    status: 'awarded',
    classificationCodes: ['NAICS:541512'],
    description: 'Cloud software support.',
    matchedFields: ['description'],
    matchReason: 'Keyword matched description.',
    fitScore: 70,
    fitReason: 'Strong fit.',
    redFlags: [],
    recommendedAction: 'partner_lead',
    contractUrl: 'https://www.usaspending.gov/award/abc',
    scrapedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

test('creates a baseline and an unchanged repeat', () => {
  const first = applyMonitoring(record(), null, 'US Software', 12);
  assert.equal(first.record.monitoringStatus, 'baseline');
  assert.equal(first.record.observationCount, 1);
  const repeat = applyMonitoring(record({ scrapedAt: '2026-07-15T00:00:00.000Z' }), first.nextState, 'US Software', 12);
  assert.equal(repeat.record.monitoringStatus, 'unchanged');
  assert.equal(repeat.record.observationCount, 2);
  assert.deepEqual(repeat.record.changedFields, []);
});

test('reports value, recipient, status and score changes', () => {
  const first = applyMonitoring(record(), null, 'US Software', 12);
  const update = applyMonitoring(record({
    recipientName: 'New Vendor',
    contractValue: 125000,
    status: 'modified',
    fitScore: 80,
    scrapedAt: '2026-07-15T00:00:00.000Z',
  }), first.nextState, 'US Software', 12);
  assert.equal(update.record.monitoringStatus, 'updated');
  assert.equal(update.record.contractValueDelta, 25000);
  assert.equal(update.record.fitScoreDelta, 10);
  assert.ok(update.record.changeSignals?.includes('recipient_changed'));
  assert.ok(update.record.changeSignals?.includes('contract_value_increased'));
  assert.ok(update.record.changeSignals?.includes('status_changed'));
});

test('marks incomplete responses partial and retains the last complete observation', () => {
  const first = applyMonitoring(record(), null, 'US Software', 2);
  const partial = applyMonitoring(record({
    recipientName: null,
    contractValue: null,
    currency: null,
    scrapedAt: '2026-07-15T00:00:00.000Z',
  }), first.nextState, 'US Software', 2);
  assert.equal(partial.record.monitoringStatus, 'partial');
  assert.equal(partial.nextState.history.at(-1)?.recipientName, 'Example Vendor');
  assert.equal(partial.nextState.history.at(-1)?.contractValue, 100000);
});

test('uses deterministic hashed storage names and keys', () => {
  assert.match(monitoringStoreName('US Software'), /^gov-contract-monitor-[a-f0-9]{24}$/);
  assert.match(monitoringRecordKey(record()), /^CONTRACT_[a-f0-9]{40}$/);
  assert.equal(monitoringStoreName('US Software'), monitoringStoreName('us software'));
});
