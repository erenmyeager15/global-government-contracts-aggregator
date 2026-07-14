import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateJobBudget, CONTRACT_EVENT, saveUniqueRecords } from './billing.js';
import type { ContractRecord } from './types.js';

function record(id: string): ContractRecord {
  return {
    source: 'uk_contracts_finder',
    keyword: null,
    recordKey: `uk_contracts_finder:${id}`,
    contractId: id,
    title: `Tender ${id}`,
    buyerName: null,
    buyerCountry: 'England',
    buyerRegion: null,
    noticeType: 'tender',
    stage: 'tender',
    procurementMethod: null,
    contractValue: null,
    currency: null,
    publishedDate: null,
    lastModifiedDate: null,
    deadlineDate: null,
    status: 'active',
    classificationCodes: [],
    description: null,
    matchedFields: [],
    matchReason: null,
    fitScore: 0,
    fitReason: 'Not scored yet.',
    redFlags: [],
    recommendedAction: 'monitor',
    contractUrl: `https://www.contractsfinder.service.gov.uk/Notice/${id}`,
    scrapedAt: '2026-07-14T00:00:00.000Z',
  };
}

test('allocates a fair dynamic budget across remaining jobs', () => {
  assert.equal(allocateJobBudget(10, 4), 3);
  assert.equal(allocateJobBudget(2, 5), 1);
  assert.equal(allocateJobBudget(0, 2), 0);
});
test('counts a normal paid row once and uses the primary event', async () => {
  const state = { seen: new Set<string>(), savedRecords: [] as ContractRecord[], maximumResults: 5 };
  const events: string[] = [];
  const result = await saveUniqueRecords([record('one')], state, async (_record, event) => {
    events.push(event);
    return { chargedCount: 1, eventChargeLimitReached: false };
  });
  assert.equal(result.saved, 1);
  assert.deepEqual(events, [CONTRACT_EVENT]);
  assert.equal(state.savedRecords.length, 1);
});

test('counts free-user rows when no charge-limit stop is reported', async () => {
  const state = { seen: new Set<string>(), savedRecords: [] as ContractRecord[], maximumResults: 5 };
  const result = await saveUniqueRecords([record('free')], state, async () => ({
    chargedCount: 0,
    eventChargeLimitReached: false,
  }));
  assert.equal(result.saved, 1);
  assert.equal(state.savedRecords.length, 1);
});

test('does not count a row rejected by the event charge limit', async () => {
  const state = { seen: new Set<string>(), savedRecords: [] as ContractRecord[], maximumResults: 5 };
  const result = await saveUniqueRecords([record('blocked')], state, async () => ({
    chargedCount: 0,
    eventChargeLimitReached: true,
  }));
  assert.deepEqual(result, { saved: 0, stoppedByChargeLimit: true });
  assert.equal(state.savedRecords.length, 0);
});

test('deduplicates stable opportunity keys before billing', async () => {
  const state = { seen: new Set<string>(), savedRecords: [] as ContractRecord[], maximumResults: 5 };
  let calls = 0;
  await saveUniqueRecords([record('same'), record('same')], state, async () => {
    calls += 1;
    return { chargedCount: 1, eventChargeLimitReached: false };
  });
  assert.equal(calls, 1);
  assert.equal(state.savedRecords.length, 1);
});
