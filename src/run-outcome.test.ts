import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRunOutcome } from './run-outcome.js';

test('distinguishes legitimate empty, partial, failed, and charge-limit outcomes', () => {
  assert.equal(classifyRunOutcome({ attemptedJobs: 2, successfulJobs: 2, warningCount: 0, savedCount: 0, stoppedByChargeLimit: false }), 'empty');
  assert.equal(classifyRunOutcome({ attemptedJobs: 2, successfulJobs: 1, warningCount: 1, savedCount: 0, stoppedByChargeLimit: false }), 'partial');
  assert.equal(classifyRunOutcome({ attemptedJobs: 2, successfulJobs: 0, warningCount: 2, savedCount: 0, stoppedByChargeLimit: false }), 'failed');
  assert.equal(classifyRunOutcome({ attemptedJobs: 1, successfulJobs: 1, warningCount: 0, savedCount: 1, stoppedByChargeLimit: true }), 'charge_limit');
  assert.equal(classifyRunOutcome({ attemptedJobs: 1, successfulJobs: 1, warningCount: 0, savedCount: 1, stoppedByChargeLimit: false }), 'success');
});
