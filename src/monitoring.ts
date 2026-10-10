import { createHash } from 'node:crypto';
import type {
  ContractRecord,
  TenderMonitoringState,
  TenderObservation,
} from './types.js';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function rounded(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export function monitoringStoreName(monitorName: string): string {
  return `gov-contract-monitor-${hash(monitorName.trim().toLowerCase()).slice(0, 24)}`;
}

export function monitoringRecordKey(record: Pick<ContractRecord, 'recordKey'>): string {
  return `CONTRACT_${hash(record.recordKey).slice(0, 40)}`;
}

function observationFor(record: ContractRecord): TenderObservation {
  return {
    checkedAt: record.scrapedAt,
    title: record.title,
    buyerName: record.buyerName,
    recipientName: record.recipientName,
    contractValue: record.contractValue,
    currency: record.currency,
    lastModifiedDate: record.lastModifiedDate,
    deadlineDate: record.deadlineDate,
    performanceEndDate: record.performanceEndDate,
    status: record.status,
    fitScore: record.fitScore,
    recommendedAction: record.recommendedAction,
  };
}

function retainedObservation(
  current: TenderObservation,
  previous: TenderObservation | null,
): TenderObservation {
  if (!previous) return current;
  return {
    ...current,
    buyerName: current.buyerName ?? previous.buyerName,
    recipientName: current.recipientName ?? previous.recipientName,
    contractValue: current.contractValue ?? previous.contractValue,
    currency: current.currency ?? previous.currency,
    lastModifiedDate: current.lastModifiedDate ?? previous.lastModifiedDate,
    deadlineDate: current.deadlineDate ?? previous.deadlineDate,
    performanceEndDate: current.performanceEndDate ?? previous.performanceEndDate,
    status: current.status ?? previous.status,
  };
}

function changed<T>(current: T | null, previous: T | null): boolean {
  return current !== null && current !== previous;
}

function isIncomplete(current: TenderObservation, previous: TenderObservation): boolean {
  const fields: Array<keyof TenderObservation> = [
    'buyerName',
    'recipientName',
    'contractValue',
    'currency',
    'lastModifiedDate',
    'deadlineDate',
    'performanceEndDate',
    'status',
  ];
  return fields.some((field) => previous[field] !== null && current[field] === null);
}

function dayDelta(current: string | null, previous: string | null): number | null {
  if (!current || !previous) return null;
  const delta = Date.parse(current) - Date.parse(previous);
  return Number.isFinite(delta) ? rounded(delta / 86_400_000, 2) : null;
}

export interface MonitoringResult {
  record: ContractRecord;
  nextState: TenderMonitoringState;
}

export function applyMonitoring(
  record: ContractRecord,
  previousState: TenderMonitoringState | null,
  monitorName: string,
  historyLimit: number,
): MonitoringResult {
  const rawCurrent = observationFor(record);
  const previous = previousState?.history.at(-1) ?? null;
  const current = retainedObservation(rawCurrent, previous);
  const changedFields: string[] = [];
  const changeSignals: string[] = [];

  if (previous) {
    if (rawCurrent.title !== previous.title) changedFields.push('title');
    if (changed(rawCurrent.buyerName, previous.buyerName)) changedFields.push('buyerName');
    if (changed(rawCurrent.recipientName, previous.recipientName)) {
      changedFields.push('recipientName');
      changeSignals.push('recipient_changed');
    }
    if (changed(rawCurrent.contractValue, previous.contractValue)
      || changed(rawCurrent.currency, previous.currency)) {
      changedFields.push('contractValue');
      if (rawCurrent.contractValue !== null && previous.contractValue !== null) {
        changeSignals.push(rawCurrent.contractValue > previous.contractValue
          ? 'contract_value_increased'
          : 'contract_value_decreased');
      } else {
        changeSignals.push('contract_currency_changed');
      }
    }
    if (changed(rawCurrent.deadlineDate, previous.deadlineDate)) {
      changedFields.push('deadlineDate');
      const delta = dayDelta(rawCurrent.deadlineDate, previous.deadlineDate);
      if (delta !== null) changeSignals.push(delta > 0 ? 'deadline_extended' : 'deadline_shortened');
    }
    if (changed(rawCurrent.performanceEndDate, previous.performanceEndDate)) {
      changedFields.push('performanceEndDate');
      changeSignals.push('performance_period_changed');
    }
    if (changed(rawCurrent.status, previous.status)) {
      changedFields.push('status');
      changeSignals.push('status_changed');
    }
    if (changed(rawCurrent.lastModifiedDate, previous.lastModifiedDate)) {
      changedFields.push('lastModifiedDate');
    }
    if (rawCurrent.fitScore !== previous.fitScore) {
      changedFields.push('fitScore');
      changeSignals.push(rawCurrent.fitScore > previous.fitScore ? 'fit_improved' : 'fit_declined');
    }
    if (rawCurrent.recommendedAction !== previous.recommendedAction) {
      changedFields.push('recommendedAction');
      changeSignals.push('recommended_action_changed');
    }
  }

  const incomplete = previous ? isIncomplete(rawCurrent, previous) : false;
  const monitoringStatus = !previous
    ? 'baseline'
    : incomplete
      ? 'partial'
      : changedFields.length
        ? 'updated'
        : 'unchanged';
  const firstSeenAt = previousState?.firstSeenAt ?? record.scrapedAt;
  const observationCount = (previousState?.observationCount ?? 0) + 1;
  const contractValueDelta = rawCurrent.contractValue !== null && previous?.contractValue !== null
    && previous?.contractValue !== undefined
    ? rounded(rawCurrent.contractValue - previous.contractValue)
    : null;
  const fitScoreDelta = previous ? rawCurrent.fitScore - previous.fitScore : null;

  return {
    record: {
      ...record,
      monitorName,
      monitoringStatus,
      firstSeenAt,
      previousSeenAt: previous?.checkedAt ?? null,
      observationCount,
      changedFields,
      previousContractValue: previous?.contractValue ?? null,
      contractValueDelta,
      previousDeadlineDate: previous?.deadlineDate ?? null,
      deadlineChangeDays: previous ? dayDelta(rawCurrent.deadlineDate, previous.deadlineDate) : null,
      previousStatus: previous?.status ?? null,
      previousRecipientName: previous?.recipientName ?? null,
      previousFitScore: previous?.fitScore ?? null,
      fitScoreDelta,
      changeSignals,
    },
    nextState: {
      schemaVersion: 1,
      firstSeenAt,
      observationCount,
      history: [...(previousState?.history ?? []), current].slice(-historyLimit),
    },
  };
}
