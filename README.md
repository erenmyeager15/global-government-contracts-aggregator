# Global Government Contracts & Tenders Scraper

Search and triage official public procurement opportunities from UK, EU, and US government sources in one normalized dataset. This Actor helps vendors, consultants, capture teams, proposal teams, and market researchers monitor public-sector contracts and tenders with clean fields for buyers, deadlines, values, categories, locations, statuses, fit evidence, and official source URLs.

Use it to build a repeatable government-contract lead feed, compare procurement markets by region or category, or export tenders into spreadsheets, CRMs, dashboards, and research workflows.

## Supported Sources

| Source | Coverage | API key required | Notes |
| --- | --- | --- | --- |
| UK Contracts Finder | UK public-sector tenders and notices | No | Uses the official OCDS API. |
| EU TED | EU public procurement notices | No | Uses the official TED Search API. |
| SAM.gov | US federal opportunities | Yes | Requires your own SAM.gov public API key. |

The default input searches **UK Contracts Finder** and **EU TED**. Add `sam_gov` only when you have a SAM.gov API key.

## What This Actor Extracts

- Source name and keyword used
- Stable source-scoped record key and source contract ID
- Contract title and description
- Buyer / contracting authority
- Buyer country and region
- Notice type, stage, and procurement method
- Contract value and currency where available
- Published, last-modified, and deadline dates
- Keyword match fields and a short match reason
- Deterministic fit score, fit reason, objective red flags, and recommended action
- Status such as active, closed, awarded, modified, or cancelled
- CPV, NAICS, PSC, or other classification codes
- Official contract or tender URL
- Scraped timestamp

The output is focused on official public procurement records and organization-level opportunity data. The Actor redacts email addresses and phone numbers from descriptions and does not intentionally collect personal contact lists, private account data, or non-public information.

## Use Cases

- Monitor new government contracts and tenders by keyword.
- Build public-sector opportunity feeds for vendors and consultants.
- Track deadlines for proposal, bid, capture, and sales teams.
- Research procurement demand by country, buyer, category, value, and status.
- Feed dashboards, spreadsheets, CRMs, or internal lead-scoring workflows.
- Compare UK, EU, and US procurement markets in one normalized export.

## Quick Start

### Ranked tender-intelligence report

Use a decision profile when you want a review queue instead of only a raw tender export.

```json
{
  "sources": ["uk_contracts_finder"],
  "keywords": ["software"],
  "noticeStatus": "active",
  "decisionProfile": {
    "preferredKeywords": ["software", "cloud", "cybersecurity"],
    "preferredRegions": ["London", "United Kingdom"],
    "preferredCategories": ["72000000", "IT services"],
    "excludedKeywords": ["hardware only"],
    "minimumContractValue": 100000,
    "minimumValueCurrency": "GBP",
    "minimumDaysToDeadline": 7
  },
  "maxResults": 10,
  "proxyConfiguration": {
    "useApifyProxy": false
  }
}
```

The Actor saves the normalized records and writes a ranked `TENDER_REPORT` Markdown file. Scores use only published notice fields; they do not predict win probability or replace a human bid/no-bid review.

Use this small input for a first run without any API key:

```json
{
  "sources": ["uk_contracts_finder", "ted"],
  "keywords": ["software"],
  "dateFrom": "2026-06-01",
  "dateTo": "2026-06-13",
  "noticeStatus": "active",
  "maxResults": 10
}
```

To search recent tenders from the default sources, you can also leave `keywords` empty:

```json
{
  "sources": ["uk_contracts_finder", "ted"],
  "keywords": [],
  "noticeStatus": "active",
  "maxResults": 20
}
```

To include SAM.gov, add `"sam_gov"` to `sources` and provide `samApiKey`:

```json
{
  "sources": ["sam_gov"],
  "keywords": ["cybersecurity"],
  "dateFrom": "2026-06-01",
  "dateTo": "2026-06-13",
  "country": "CA",
  "samApiKey": "YOUR_SAM_GOV_API_KEY",
  "maxResults": 25
}
```

## Input Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `sources` | array | `["uk_contracts_finder", "ted"]` | Official procurement sources to search. SAM.gov requires `samApiKey`. |
| `keywords` | string array | `["software"]` | Optional search terms. Leave empty to return recent tenders from selected sources. |
| `dateFrom` | string | 30 days ago | Publication start date in `YYYY-MM-DD` format. |
| `dateTo` | string | today | Publication end date in `YYYY-MM-DD` format. |
| `country` | string | empty | Optional country/region text filter. For SAM.gov, use a US state code such as `CA` or `NY`. |
| `noticeStatus` | `active`, `all` | `active` | Target active/open opportunities where supported, or include all available notices. |
| `decisionProfile` | object | optional | Preferred keywords, regions, categories, exclusions, value threshold/currency, and minimum deadline window used for deterministic triage. |
| `maxResults` | integer | `10` | Maximum total records saved across all selected sources and keywords. |
| `samApiKey` | string | empty | SAM.gov public API key, required only when `sam_gov` is selected. |
| `proxyConfiguration` | object | no proxy | Usually not needed for official APIs, but available for enterprise network routing. |

## Output Overview

Each dataset item represents one normalized public procurement record.

| Field group | Important fields |
| --- | --- |
| Source context | `source`, `keyword`, `scrapedAt` |
| Opportunity identity | `recordKey`, `contractId`, `title`, `noticeType`, `stage`, `status`, `contractUrl` |
| Buyer and location | `buyerName`, `buyerCountry`, `buyerRegion` |
| Tender timing | `publishedDate`, `lastModifiedDate`, `deadlineDate` |
| Commercial detail | `contractValue`, `currency`, `procurementMethod`, `classificationCodes` |
| Description | `description` with email and phone-like text redacted where detected |
| Match evidence | `matchedFields`, `matchReason` |
| Decision support | `fitScore`, `fitReason`, `redFlags`, `recommendedAction` |

## Verified Output Example

The following record was saved from UK Contracts Finder by verification run `jKAewnN2Nk1XmI0pQ` on July 11, 2026. The description is shortened here for readability; the dataset retains the redacted source description.

```json
{
  "source": "uk_contracts_finder",
  "keyword": "software",
  "recordKey": "uk_contracts_finder:ocds-b5fd17-5d26e35b-71a8-4b92-8178-8a47a5fef7be",
  "contractId": "ocds-b5fd17-5d26e35b-71a8-4b92-8178-8a47a5fef7be",
  "title": "CA18209 - The Mercian Trust Outsourced Payroll Service and HR and Payroll System",
  "buyerName": "The Mercian Trust",
  "buyerCountry": "England",
  "buyerRegion": "Walsall",
  "noticeType": "tender",
  "stage": "tender",
  "procurementMethod": "Open procedure",
  "contractValue": 400000,
  "currency": "GBP",
  "publishedDate": "2026-07-10T09:09:10.000Z",
  "lastModifiedDate": "2026-07-10T09:09:10.000Z",
  "deadlineDate": "2026-08-26T11:00:00.000Z",
  "status": "active",
  "classificationCodes": ["CPV:79631000 Personnel and payroll services"],
  "description": "The Trust is procuring a cloud-based HR and Payroll software system and outsourced payroll service.",
  "matchedFields": ["description"],
  "matchReason": "Keyword \"software\" matched description.",
  "fitScore": 80,
  "fitReason": "preferred keywords matched: software, cloud; preferred region matched: England; contract value published; 47 day(s) remain before deadline; active tender",
  "redFlags": ["No preferred category matched."],
  "recommendedAction": "review_now",
  "contractUrl": "https://www.contractsfinder.service.gov.uk/Notice/5fddd1b5-9a5f-48d0-9638-7f5377d5c06c-905563",
  "scrapedAt": "2026-07-11T07:43:26.670Z"
}
```

## Pricing

| Event | Price | When charged |
| --- | ---: | --- |
| `contract-scraped` | `$0.004` | Once per clean contract/tender record saved |

Records are saved and charged atomically with `contract-scraped`. The Actor skips duplicate source IDs and stops later sources/keywords when the user's spending limit is reached.

## Change Tracking And Digest Rules

For recurring tender alerts, use `recordKey` as the stable identity. Do not add
`publishedDate` or `lastModifiedDate` to the identity, because doing so turns an update
into a duplicate opportunity.

Compare the current record with the previous record for the same `recordKey`. Treat it
as updated when `lastModifiedDate`, `deadlineDate`, `status`, `contractValue`,
`description`, or another decision field changes. This preserves one opportunity while
still surfacing amendments and reissued information.

Date-only deadlines from sources such as TED are normalized to `23:59:59.999Z` so an
opportunity is not treated as expired at the start of its final calendar day. Exact
source timestamps retain their original moment after conversion to UTC.

Keyword evidence checks the longer `description` first, then title, classification,
buyer, location, notice, stage, and procurement-method fields. `matchedFields` and
`matchReason` explain why the record entered the result set.

## Fit Scoring And Recommendations

The fit score is a transparent prioritization aid, not an AI prediction. It uses:

- preferred and excluded keyword matches in the published notice
- preferred buyer country/region and category/code matches
- published contract value against an optional same-currency threshold
- deadline availability and remaining time
- active/closed status and tender/award stage

`review_now`, `review`, `monitor`, and `skip` are deterministic recommendations. An expired/closed opportunity, an excluded keyword, or a published value below the configured minimum forces `skip`. Missing values and currency mismatches are flagged; the Actor never performs hidden exchange-rate conversion.

Every run writes `TENDER_REPORT` to the default key-value store and links it from the Output tab. Opportunities are ordered by `fitScore`, with red flags and official source links visible in the same table.

## Tips For Better Results

- Start with `maxResults: 10` to check the output before scaling.
- Use focused keywords such as `cybersecurity`, `software`, `facilities management`, or `medical equipment`.
- Review `matchedFields` and `matchReason` when building qualification or alert workflows.
- Leave `keywords` empty when you want a broad recent-opportunity feed.
- Keep `noticeStatus` as `active` for open opportunities and switch to `all` for market research.
- Use SAM.gov only when you have a valid public API key from SAM.gov.

## Known Limits

- Source APIs can differ in how they expose values, deadlines, locations, and classifications.
- Some notices do not publish contract values or exact deadlines.
- Fit scores depend only on fields exposed by the official source. They do not estimate competition, incumbent advantage, certification eligibility, procurement-law compliance, or win probability.
- Contract values are compared only when the record currency matches `minimumValueCurrency`; no currency conversion is performed.
- SAM.gov's public search response does not expose a separate modification timestamp, so `lastModifiedDate` falls back to `publishedDate` for that source.
- SAM.gov data is skipped when `sam_gov` is selected without `samApiKey`.
- Country filtering is a text filter for UK/TED and a US state-code filter for SAM.gov.

## Responsible Use

Use this Actor only for lawful purposes and in compliance with the source websites' terms, robots.txt, applicable privacy laws, and local regulations. This Actor is designed for official public procurement records and does not intentionally collect personal contact lists, private account data, or non-public information.

## Notes

- SAM.gov requires a user-provided public API key.
- EU TED Search API is public and does not require a key for published notices.
- UK Contracts Finder returns OCDS data under the UK Open Government Licence.
