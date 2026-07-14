import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInput } from './input.js';

const NOW = new Date('2026-07-14T12:00:00.000Z');

test('normalizes defaults and keeps the schema default keyword', () => {
  const input = normalizeInput(null, NOW);
  assert.deepEqual(input.sources, ['uk_contracts_finder', 'ted']);
  assert.deepEqual(input.keywords, ['software']);
  assert.equal(input.dateFrom, '2026-06-14');
  assert.equal(input.dateTo, '2026-07-14');
  assert.equal(input.maxResults, 10);
});

test('deduplicates sources and keywords case-insensitively', () => {
  const input = normalizeInput({
    sources: ['TED', 'ted'],
    keywords: ['Software', ' software '],
    maxResults: 5,
  }, NOW);
  assert.deepEqual(input.sources, ['ted']);
  assert.deepEqual(input.keywords, ['Software']);
});

test('allows an explicit empty keyword list for a broad recent feed', () => {
  assert.deepEqual(normalizeInput({ sources: ['ted'], keywords: [], maxResults: 1 }, NOW).keywords, []);
});

test('rejects invalid calendar dates and reversed ranges', () => {
  assert.throws(
    () => normalizeInput({ sources: ['ted'], dateFrom: '2026-02-30', dateTo: '2026-03-01', maxResults: 1 }, NOW),
    /real calendar date/,
  );
  assert.throws(
    () => normalizeInput({ sources: ['ted'], dateFrom: '2026-07-10', dateTo: '2026-07-01', maxResults: 1 }, NOW),
    /cannot be later/,
  );
});

test('rejects publication ranges above the resource ceiling', () => {
  assert.throws(
    () => normalizeInput({ sources: ['ted'], dateFrom: '2024-01-01', dateTo: '2026-01-01', maxResults: 1 }, NOW),
    /cannot exceed 366 calendar days/,
  );
});

test('rejects invalid maxResults instead of silently clamping it', () => {
  assert.throws(() => normalizeInput({ sources: ['ted'], maxResults: 0 }, NOW), /integer from 1 to 1000/);
  assert.throws(() => normalizeInput({ sources: ['ted'], maxResults: 1.5 }, NOW), /integer from 1 to 1000/);
  assert.throws(() => normalizeInput({ sources: ['ted'], maxResults: 1001 }, NOW), /integer from 1 to 1000/);
});

test('requires a SAM.gov key when that source is selected', () => {
  assert.throws(
    () => normalizeInput({ sources: ['sam_gov'], maxResults: 1 }, NOW),
    /samApiKey is required/,
  );
});

test('rejects enabled proxy routing because official APIs are called directly', () => {
  assert.throws(
    () => normalizeInput({ sources: ['ted'], maxResults: 1, proxyConfiguration: { useApifyProxy: true } }, NOW),
    /Proxy routing is not supported/,
  );
  assert.throws(
    () => normalizeInput({ sources: ['ted'], maxResults: 1, proxyConfiguration: { useApifyProxy: 'yes' } }, NOW),
    /Proxy routing is not supported/,
  );
});

test('requires a currency when a minimum contract value is configured', () => {
  assert.throws(
    () => normalizeInput({
      sources: ['ted'],
      maxResults: 1,
      decisionProfile: { minimumContractValue: 1000 },
    }, NOW),
    /minimumValueCurrency is required/,
  );
});

test('rejects unknown input fields', () => {
  assert.throws(
    () => normalizeInput({ sources: ['ted'], maxResults: 1, unexpected: true }, NOW),
    /unsupported field/,
  );
});
