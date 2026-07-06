export type SourceName = 'uk_contracts_finder' | 'ted' | 'sam_gov';

export interface ActorInput {
  sources?: SourceName[];
  keywords?: string[];
  dateFrom?: string;
  dateTo?: string;
  country?: string;
  noticeStatus?: 'active' | 'all';
  maxResults?: number;
  samApiKey?: string;
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
}

export interface ContractRecord {
  source: 'uk_contracts_finder' | 'ted' | 'sam_gov';
  keyword: string | null;
  recordKey: string;
  contractId: string;
  title: string;
  buyerName: string | null;
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
  status: string | null;
  classificationCodes: string[];
  description: string | null;
  matchedFields: string[];
  matchReason: string | null;
  contractUrl: string | null;
  scrapedAt: string;
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
  active?: string;
  responseDeadLine?: string;
  naicsCode?: string;
  classificationCode?: string;
  archiveDate?: string;
  award?: { amount?: string | number; date?: string };
  placeOfPerformance?: { city?: { name?: string; state?: { name?: string } }; state?: { name?: string }; country?: { name?: string } };
  uiLink?: string;
  description?: string;
}
