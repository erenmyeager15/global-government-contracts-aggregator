import { Actor, log } from 'apify';
import { allocateJobBudget, saveUniqueRecords } from './billing.js';
import { normalizeInput } from './input.js';
import { applyMonitoring, monitoringRecordKey, monitoringStoreName } from './monitoring.js';
import { assertSafeRecord } from './record-safety.js';
import { classifyRunOutcome } from './run-outcome.js';
import { scrapeSource } from './sources.js';
import { applyTenderIntelligence, buildTenderReport } from './tender-intelligence.js';
import type { ContractRecord, SourceName, SourceWarning, TenderMonitoringState } from './types.js';

interface SourceJob {
  source: SourceName;
  keyword: string | null;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/([?&](?:api_key|apikey|key|token|access_token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

await Actor.init();

try {
  const runStartedAt = new Date();
  const input = normalizeInput(await Actor.getInput<unknown>(), runStartedAt);
  const keywords = input.keywords.length ? input.keywords : [null];
  const jobs: SourceJob[] = keywords.flatMap((keyword) =>
    input.sources.map((source) => ({ source, keyword })));
  const state = {
    seen: new Set<string>(),
    savedRecords: [] as ContractRecord[],
    maximumResults: input.maxResults,
  };
  const warnings: SourceWarning[] = [];
  let attemptedJobs = 0;
  let successfulJobs = 0;
  let stoppedByChargeLimit = false;
  let stateReadFailures = 0;
  let stateWriteFailures = 0;
  const monitoringStatusCounts = {
    baseline: 0,
    updated: 0,
    unchanged: 0,
    partial: 0,
  };
  const monitoringStore = input.trackChanges
    ? await Actor.openKeyValueStore(monitoringStoreName(input.monitorName))
    : null;

  log.info('Starting global government contracts scrape', {
    sources: input.sources,
    keywords,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    maxResults: input.maxResults,
    trackChanges: input.trackChanges,
    monitorName: input.trackChanges ? input.monitorName : null,
  });

  for (let index = 0; index < jobs.length; index += 1) {
    if (state.savedRecords.length >= input.maxResults || stoppedByChargeLimit) break;
    const job = jobs[index];
    const remainingResults = input.maxResults - state.savedRecords.length;
    const budget = allocateJobBudget(remainingResults, jobs.length - index);
    if (budget <= 0) break;
    attemptedJobs += 1;

    log.info('Searching official procurement source', {
      source: job.source,
      keyword: job.keyword,
      resultBudget: budget,
    });

    let records: ContractRecord[];
    const pendingStates = new Map<string, { key: string; state: TenderMonitoringState }>();
    try {
      const sourceRecords = await scrapeSource(job.source, {
        input,
        keyword: job.keyword,
        limit: budget,
        excludedKeys: state.seen,
        now: runStartedAt,
      });
      records = [];
      for (const sourceRecord of sourceRecords) {
        let record = applyTenderIntelligence(sourceRecord, input.decisionProfile, runStartedAt);
        if (monitoringStore) {
          const key = monitoringRecordKey(record);
          let previousState: TenderMonitoringState | null = null;
          try {
            previousState = await monitoringStore.getValue<TenderMonitoringState>(key);
          } catch (error) {
            stateReadFailures += 1;
            warnings.push({
              source: job.source,
              keyword: job.keyword,
              message: `Change-history read failed; returning a fresh baseline: ${safeErrorMessage(error)}`,
            });
          }
          const monitored = applyMonitoring(
            record,
            previousState,
            input.monitorName,
            input.observationHistoryLimit,
          );
          record = monitored.record;
          pendingStates.set(record.recordKey, { key, state: monitored.nextState });
        }
        records.push(assertSafeRecord(record));
      }
      successfulJobs += 1;
    } catch (error) {
      const warning: SourceWarning = {
        source: job.source,
        keyword: job.keyword,
        message: safeErrorMessage(error),
      };
      warnings.push(warning);
      log.warning('Official procurement source failed', warning);
      continue;
    }

    // A push failure is intentionally fatal. Retrying or continuing could make the
    // saved-row and charge state ambiguous even though pushData itself is atomic.
    const saveResult = await saveUniqueRecords(
      records,
      state,
      async (record, eventName) => {
        const result = await Actor.pushData(record, eventName);
        const recordWasSaved = result.chargedCount > 0 || !result.eventChargeLimitReached;
        if (recordWasSaved && record.monitoringStatus) {
          monitoringStatusCounts[record.monitoringStatus] += 1;
        }
        const pending = pendingStates.get(record.recordKey);
        if (recordWasSaved && monitoringStore && pending) {
          try {
            await monitoringStore.setValue(pending.key, pending.state);
          } catch (error) {
            stateWriteFailures += 1;
            warnings.push({
              source: job.source,
              keyword: job.keyword,
              message: `Contract row was saved, but its change history could not be updated: ${safeErrorMessage(error)}`,
            });
          }
        }
        return result;
      },
    );
    stoppedByChargeLimit = saveResult.stoppedByChargeLimit;
  }

  const allAttemptedSourcesFailed = attemptedJobs > 0 && successfulJobs === 0;
  const outcome = classifyRunOutcome({
    attemptedJobs,
    successfulJobs,
    warningCount: warnings.length,
    savedCount: state.savedRecords.length,
    stoppedByChargeLimit,
  });

  await Actor.setValue('TENDER_REPORT', buildTenderReport(state.savedRecords, input, warnings), {
    contentType: 'text/markdown; charset=utf-8',
  });
  await Actor.setValue('RUN_SUMMARY', {
    generatedAt: new Date().toISOString(),
    outcome,
    savedCount: state.savedRecords.length,
    attemptedSearches: attemptedJobs,
    successfulSearches: successfulJobs,
    failedSearches: attemptedJobs - successfulJobs,
    stoppedByChargeLimit,
    changeTracking: {
      enabled: input.trackChanges,
      monitorName: input.trackChanges ? input.monitorName : null,
      historyLimit: input.trackChanges ? input.observationHistoryLimit : null,
      statusCounts: monitoringStatusCounts,
      stateReadFailures,
      stateWriteFailures,
    },
    warnings,
  });

  if (allAttemptedSourcesFailed) {
    throw new Error(`All ${attemptedJobs} official source search(es) failed. See RUN_SUMMARY for safe diagnostics.`);
  }

  let message: string;
  if (stoppedByChargeLimit) {
    message = `Stopped at the user's spending limit after ${state.savedRecords.length} contract(s).`;
    log.warning(message);
  } else if (warnings.length) {
    message = `Finished with ${state.savedRecords.length} contract(s) and ${warnings.length} source warning(s).`;
    log.warning(message);
  } else if (!state.savedRecords.length) {
    message = 'Finished successfully: no matching opportunities were found.';
    log.info(message);
  } else {
    message = `Finished with ${state.savedRecords.length} unique contract(s).`;
    log.info('Government contracts scrape finished', { savedCount: state.savedRecords.length });
  }
  await Actor.setStatusMessage(message);
} catch (error) {
  const message = safeErrorMessage(error);
  log.exception(error as Error, 'Global government contracts actor failed');
  await Actor.fail(`Failed: ${message}`);
}

await Actor.exit();
