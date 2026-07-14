import type { ContractRecord } from './types.js';

export const CONTRACT_EVENT = 'contract-scraped';

export interface PushDataResult {
  chargedCount: number;
  eventChargeLimitReached: boolean;
}
export interface SaveState {
  seen: Set<string>;
  savedRecords: ContractRecord[];
  maximumResults: number;
}

export interface SaveResult {
  saved: number;
  stoppedByChargeLimit: boolean;
}

export function allocateJobBudget(remainingResults: number, remainingJobs: number): number {
  if (remainingResults <= 0 || remainingJobs <= 0) return 0;
  return Math.min(remainingResults, Math.max(1, Math.ceil(remainingResults / remainingJobs)));
}

export async function saveUniqueRecords(
  records: ContractRecord[],
  state: SaveState,
  pushData: (record: ContractRecord, eventName: string) => Promise<PushDataResult>,
): Promise<SaveResult> {
  let saved = 0;
  for (const record of records) {
    if (state.savedRecords.length >= state.maximumResults) break;
    if (state.seen.has(record.recordKey)) continue;

    // Do not retry this call: pushData stores the row and charges the event atomically.
    const result = await pushData(record, CONTRACT_EVENT);
    const recordWasSaved = result.chargedCount > 0 || !result.eventChargeLimitReached;
    if (recordWasSaved) {
      state.seen.add(record.recordKey);
      state.savedRecords.push(record);
      saved += 1;
    }
    if (result.eventChargeLimitReached) {
      return { saved, stoppedByChargeLimit: true };
    }
  }
  return { saved, stoppedByChargeLimit: false };
}
