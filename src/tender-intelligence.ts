import type {
  ContractRecord,
  DecisionProfile,
  DecisionProfileInput,
  NormalizedInput,
  RecommendedAction,
} from './types.js';
import { normalizeText } from './tender-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function uniqueText(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = normalizeText(value);
    if (text) seen.add(text);
  }
  return [...seen];
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeDecisionProfile(
  raw: DecisionProfileInput | undefined,
  fallbackKeywords: string[],
): DecisionProfile {
  const preferredKeywords = uniqueText(raw?.preferredKeywords);
  return {
    preferredKeywords: preferredKeywords.length ? preferredKeywords : uniqueText(fallbackKeywords),
    preferredRegions: uniqueText(raw?.preferredRegions),
    preferredCategories: uniqueText(raw?.preferredCategories),
    excludedKeywords: uniqueText(raw?.excludedKeywords),
    minimumContractValue: finiteNonNegative(raw?.minimumContractValue),
    minimumValueCurrency: normalizeText(raw?.minimumValueCurrency)?.toUpperCase() ?? null,
    minimumDaysToDeadline: Math.min(Math.max(Math.floor(finiteNonNegative(raw?.minimumDaysToDeadline) ?? 7), 0), 365),
  };
}

function lower(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function matchingTerms(terms: string[], haystack: string): string[] {
  return terms.filter((term) => haystack.includes(term.toLowerCase()));
}

function opportunityText(record: ContractRecord): string {
  return lower([
    record.title,
    record.description,
    record.classificationCodes.join(' '),
    record.buyerName,
    record.buyerCountry,
    record.buyerRegion,
    record.noticeType,
    record.procurementMethod,
  ].filter(Boolean).join(' '));
}

function actionFor(score: number, blocking: boolean): RecommendedAction {
  if (blocking) return 'skip';
  if (score >= 75) return 'review_now';
  if (score >= 55) return 'review';
  if (score >= 35) return 'monitor';
  return 'skip';
}

export function applyTenderIntelligence(
  record: ContractRecord,
  profile: DecisionProfile,
  now = new Date(),
): ContractRecord {
  const allText = opportunityText(record);
  const locationText = lower(`${record.buyerCountry ?? ''} ${record.buyerRegion ?? ''}`);
  const categoryText = lower(`${record.classificationCodes.join(' ')} ${record.title} ${record.description ?? ''}`);
  const reasons: string[] = [];
  const redFlags: string[] = [];
  let score = 20;
  let blocking = false;

  if (profile.preferredKeywords.length) {
    const matched = matchingTerms(profile.preferredKeywords, allText);
    if (matched.length) {
      score += Math.min(35, 20 + ((matched.length - 1) * 5));
      reasons.push(`preferred keywords matched: ${matched.join(', ')}`);
    } else {
      score -= 20;
      redFlags.push('No preferred keyword matched.');
    }
  } else {
    score += 10;
    reasons.push('no preferred keyword restriction');
  }

  const excluded = matchingTerms(profile.excludedKeywords, allText);
  if (excluded.length) {
    score -= 40;
    blocking = true;
    redFlags.push(`Excluded keyword matched: ${excluded.join(', ')}.`);
  }

  if (profile.preferredRegions.length) {
    const matched = matchingTerms(profile.preferredRegions, locationText);
    if (matched.length) {
      score += 15;
      reasons.push(`preferred region matched: ${matched.join(', ')}`);
    } else {
      score -= 10;
      redFlags.push('Outside preferred regions.');
    }
  }

  if (profile.preferredCategories.length) {
    const matched = matchingTerms(profile.preferredCategories, categoryText);
    if (matched.length) {
      score += 15;
      reasons.push(`preferred category matched: ${matched.join(', ')}`);
    } else {
      score -= 10;
      redFlags.push('No preferred category matched.');
    }
  }

  if (profile.minimumContractValue !== null) {
    if (!profile.minimumValueCurrency) {
      score -= 5;
      redFlags.push('Minimum value currency is not configured; value threshold was not applied.');
    } else if (record.contractValue === null) {
      score -= 5;
      redFlags.push('Contract value is not published.');
    } else if (record.currency?.toUpperCase() !== profile.minimumValueCurrency) {
      score -= 5;
      redFlags.push(`Value currency ${record.currency ?? 'unknown'} differs from profile currency ${profile.minimumValueCurrency}; no conversion applied.`);
    } else if (record.contractValue >= profile.minimumContractValue) {
      score += 15;
      reasons.push(`value meets minimum ${profile.minimumContractValue}`);
    } else {
      score -= 20;
      blocking = true;
      redFlags.push(`Contract value ${record.contractValue} is below minimum ${profile.minimumContractValue}.`);
    }
  } else if (record.contractValue !== null) {
    score += 5;
    reasons.push('contract value published');
  }

  if (!record.deadlineDate) {
    score -= 5;
    redFlags.push('Deadline is not published.');
  } else {
    const deadline = new Date(record.deadlineDate);
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS);
    if (Number.isNaN(deadline.getTime())) {
      score -= 5;
      redFlags.push('Deadline could not be interpreted.');
    } else if (daysRemaining < 0) {
      score -= 30;
      blocking = true;
      redFlags.push('Deadline has passed.');
    } else if (daysRemaining < profile.minimumDaysToDeadline) {
      score -= 10;
      redFlags.push(`Only ${daysRemaining} day(s) remain before the deadline.`);
    } else {
      score += 15;
      reasons.push(`${daysRemaining} day(s) remain before deadline`);
    }
  }

  const status = lower(record.status);
  const stage = lower(record.stage);
  const closed = /closed|cancelled|canceled|awarded|modified/.test(status) || /award|contract_modification/.test(stage);
  if (closed) {
    score -= 20;
    blocking = true;
    redFlags.push(`Opportunity is not an active tender (${record.status ?? record.stage ?? 'unknown'}).`);
  } else if (/active|open/.test(status) && stage === 'tender') {
    score += 10;
    reasons.push('active tender');
  } else {
    redFlags.push('Opportunity status or stage is uncertain.');
  }

  score = Math.min(Math.max(Math.round(score), 0), 100);
  return {
    ...record,
    fitScore: score,
    fitReason: reasons.length ? reasons.join('; ') : 'No positive fit evidence was available.',
    redFlags,
    recommendedAction: actionFor(score, blocking),
  };
}

function escapeTable(value: unknown): string {
  return String(value ?? 'N/A').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function valueText(record: ContractRecord): string {
  if (record.contractValue === null) return 'Not published';
  return `${record.currency ?? ''} ${record.contractValue}`.trim();
}

export function buildTenderReport(records: ContractRecord[], input: NormalizedInput): string {
  const ordered = [...records].sort((left, right) => right.fitScore - left.fitScore);
  const profile = input.decisionProfile;
  const lines = [
    '# Tender Intelligence Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Sources: ${input.sources.join(', ')}`,
    `Preferred keywords: ${profile.preferredKeywords.join(', ') || 'None'}`,
    `Preferred regions: ${profile.preferredRegions.join(', ') || 'Any'}`,
    `Preferred categories: ${profile.preferredCategories.join(', ') || 'Any'}`,
    '',
    'Scores are deterministic triage signals from published notice fields. Review the official source before a bid/no-bid decision.',
    '',
  ];

  if (!ordered.length) {
    lines.push('No matching opportunities were saved.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('| Score | Action | Opportunity | Buyer | Region | Value | Deadline | Match evidence | Red flags |', '| ---: | --- | --- | --- | --- | ---: | --- | --- | --- |');
  for (const record of ordered) {
    const title = record.contractUrl ? `[${escapeTable(record.title)}](${record.contractUrl})` : escapeTable(record.title);
    lines.push(`| ${record.fitScore} | ${record.recommendedAction} | ${title} | ${escapeTable(record.buyerName)} | ${escapeTable(record.buyerRegion ?? record.buyerCountry)} | ${valueText(record)} | ${escapeTable(record.deadlineDate)} | ${escapeTable(record.fitReason)} | ${escapeTable(record.redFlags.join(' ') || 'None')} |`);
  }

  return `${lines.join('\n')}\n`;
}
