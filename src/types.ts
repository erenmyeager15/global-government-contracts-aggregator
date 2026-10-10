export type SourceName = 'usaspending_awards' | 'uk_contracts_finder' | 'ted' | 'sam_gov';

export interface DecisionProfileInput {
  preferredKeywords?: string[];
  preferredRegions?: string[];
  preferredCategories?: string[];
  excludedKeywords?: string[];
  minimumContractValue?: number;
  minimumValueCurrency?: string;
  minimumDaysToDeadline?: number;
}

export interface DecisionProfile {
  preferredKeywords: string[];
  preferredRegions: string[];
  preferredCategories: string[];
  excludedKeywords: string[];
  minimumContractValue: number | null;
  minimumValueCurrency: string | null;
  minimumDaysToDeadline: number;
}

export type RecommendedAction = 'review_now' | 'review' | 'partner_lead' | 'monitor' | 'skip';

export interface ActorInput {
  sources?: SourceName[];
  keywords?: string[];
  dateFrom?: string;
  dateTo?: string;
  country?: string;
  noticeStatus?: 'active' | 'all';
  maxResults?: number;
  samApiKey?: string;
  decisionProfile?: DecisionProfileInput;
  trackChanges?: boolean;
  monitorName?: string;
  observationHistoryLimit?: number;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  sources: SourceName[];
  keywords: string[];
  dateFrom: string;
  dateTo: string;
  country: string | null;
  noticeStatus: 'active' | 'all';
  maxResults: number;
  samApiKey: string | null;
  decisionProfile: DecisionProfile;
  trackChanges: boolean;
  monitorName: string;
  observationHistoryLimit: number;
}

export interface SourceWarning {
  source: SourceName;
  keyword: string | null;
  message: string;
}

export interface ContractRecord {
  source: SourceName;
  keyword: string | null;
  recordKey: string;
  contractId: string;
  title: string;
  buyerName: string | null;
  recipientName: string | null;
  buyerCountry: string | null;
  buyerRegion: string | null;
  noticeType: string | null;
  stage: string | null;
  procurementMethod: string | null;
  contractValue: number | null;
  currency: string | null;
  publishedDate: string | null;
  lastModifiedDate: string | null;
  deadlineDate: string | null;
  performanceStartDate: string | null;
  performanceEndDate: string | null;
  status: string | null;
  classificationCodes: string[];
  description: string | null;
  matchedFields: string[];
  matchReason: string | null;
  fitScore: number;
  fitReason: string;
  redFlags: string[];
  recommendedAction: RecommendedAction;
  contractUrl: string | null;
  scrapedAt: string;
  monitorName?: string | null;
  monitoringStatus?: 'baseline' | 'updated' | 'unchanged' | 'partial' | null;
  firstSeenAt?: string | null;
  previousSeenAt?: string | null;
  observationCount?: number | null;
  changedFields?: string[];
  previousContractValue?: number | null;
  contractValueDelta?: number | null;
  previousDeadlineDate?: string | null;
  deadlineChangeDays?: number | null;
  previousStatus?: string | null;
  previousRecipientName?: string | null;
  previousFitScore?: number | null;
  fitScoreDelta?: number | null;
  changeSignals?: string[];
}

export interface TenderObservation {
  checkedAt: string;
  title: string;
  buyerName: string | null;
  recipientName: string | null;
  contractValue: number | null;
  currency: string | null;
  lastModifiedDate: string | null;
  deadlineDate: string | null;
  performanceEndDate: string | null;
  status: string | null;
  fitScore: number;
  recommendedAction: RecommendedAction;
}

export interface TenderMonitoringState {
  schemaVersion: 1;
  firstSeenAt: string;
  observationCount: number;
  history: TenderObservation[];
}

export interface UkOcdsRelease {
  ocid?: string;
  id?: string;
  date?: string;
  tag?: string[];
  tender?: {
    id?: string;
    title?: string;
    description?: string;
    datePublished?: string;
    status?: string;
    classification?: { scheme?: string; id?: string; description?: string };
    additionalClassifications?: Array<{ scheme?: string; id?: string; description?: string }>;
    items?: Array<{ deliveryAddresses?: Array<{ countryName?: string; region?: string; locality?: string }> }>;
    value?: { amount?: number; currency?: string };
    procurementMethod?: string;
    procurementMethodDetails?: string;
    tenderPeriod?: { endDate?: string };
  };
  parties?: Array<{ name?: string; roles?: string[]; address?: { countryName?: string; region?: string; locality?: string } }>;
}

export interface TedNotice {
  'publication-number'?: string;
  'publication-date'?: string;
  'change-procurement-documents-date'?: string[] | string;
  'notice-title'?: Record<string, string[] | string> | string;
  'form-type'?: string[] | string;
  'notice-type'?: string[] | string;
  'notice-subtype'?: string[] | string;
  'competition-termination-proc'?: boolean | string[] | string;
  'buyer-name'?: Record<string, string[] | string> | string[];
  'buyer-country'?: string[] | string;
  'deadline-receipt-tender-date-lot'?: string[] | string;
  'deadline-receipt-request-date-lot'?: string[] | string;
  'procedure-type'?: string[] | string;
  'contract-nature'?: string[] | string;
  'estimated-value-proc'?: { value?: number | string; currency?: string } | number | string;
  'estimated-value-cur-proc'?: string[] | string;
  'estimated-value-lot'?: Array<{ value?: number | string; currency?: string }> | { value?: number | string; currency?: string };
  'estimated-value-cur-lot'?: string[] | string;
  'description-proc'?: Record<string, string[] | string> | string;
  'place-of-performance-country'?: string[] | string;
  'classification-cpv'?: string[] | string;
  links?: { html?: Record<string, string>; xml?: Record<string, string>; pdf?: Record<string, string> };
}

export interface SamOpportunity {
  noticeId?: string;
  solicitationNumber?: string;
  title?: string;
  fullParentPathName?: string;
  department?: string;
  subTier?: string;
  postedDate?: string;
  type?: string;
  baseType?: string;
  active?: boolean | string;
  responseDeadLine?: string;
  naicsCode?: string;
  classificationCode?: string;
  archiveDate?: string;
  award?: { amount?: string | number; date?: string };
  placeOfPerformance?: { city?: { name?: string; state?: { name?: string } }; state?: { name?: string }; country?: { name?: string } };
  uiLink?: string;
  description?: string;
}

export interface SamSearchResponse {
  totalRecords?: number;
  limit?: number;
  offset?: number;
  opportunitiesData?: SamOpportunity[];
}

export interface UsaSpendingAward {
  internal_id?: number;
  generated_internal_id?: string;
  'Award ID'?: string;
  'Recipient Name'?: string;
  'Award Amount'?: number | string;
  'Awarding Agency'?: string;
  'Awarding Sub Agency'?: string;
  'Start Date'?: string;
  'End Date'?: string;
  Description?: string;
  'Last Modified Date'?: string;
  'Base Obligation Date'?: string;
  'Contract Award Type'?: string;
  'Place of Performance State Code'?: string;
  'Place of Performance Country Code'?: string;
  'NAICS Code'?: string;
  'NAICS Description'?: string;
  'PSC Code'?: string;
  'PSC Description'?: string;
}

export interface UsaSpendingSearchResponse {
  spending_level?: string;
  limit?: number;
  results?: UsaSpendingAward[];
  page_metadata?: {
    page?: number;
    hasNext?: boolean;
    last_record_unique_id?: number;
    last_record_sort_value?: string;
  };
  messages?: string[];
}
