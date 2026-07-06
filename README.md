# Global Government Contracts & Tenders Scraper

Search official public procurement opportunities from UK, EU, and US government sources in one normalized dataset. This Actor helps vendors, consultants, capture teams, proposal teams, and market researchers monitor public-sector contracts and tenders with clean fields for buyers, deadlines, values, categories, locations, statuses, and official source URLs.

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

## Output Example

```json
{
  "source": "uk_contracts_finder",
  "keyword": "software",
  "recordKey": "uk_contracts_finder:ocds-b5fd17-example",
  "contractId": "ocds-b5fd17-example",
  "title": "Software support services",
  "buyerName": "Example Council",
  "buyerCountry": "United Kingdom",
  "buyerRegion": "London",
  "noticeType": "tender",
  "stage": "tender",
  "procurementMethod": "Open procedure",
  "contractValue": 250000,
  "currency": "GBP",
  "publishedDate": "2026-06-12T09:00:00.000Z",
  "lastModifiedDate": "2026-06-14T08:30:00.000Z",
  "deadlineDate": "2026-07-12T11:00:00.000Z",
  "status": "active",
  "classificationCodes": ["CPV:72000000 IT services"],
  "description": "Public contract notice summary...",
  "matchedFields": ["description", "title", "classificationCodes"],
  "matchReason": "Keyword \"software\" matched description, title, classificationCodes.",
  "contractUrl": "https://www.contractsfinder.service.gov.uk/Notice/...",
  "scrapedAt": "2026-06-13T17:00:00.000Z"
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
- SAM.gov's public search response does not expose a separate modification timestamp, so `lastModifiedDate` falls back to `publishedDate` for that source.
- SAM.gov data is skipped when `sam_gov` is selected without `samApiKey`.
- Country filtering is a text filter for UK/TED and a US state-code filter for SAM.gov.

## Responsible Use

Use this Actor only for lawful purposes and in compliance with the source websites' terms, robots.txt, applicable privacy laws, and local regulations. This Actor is designed for official public procurement records and does not intentionally collect personal contact lists, private account data, or non-public information.

## Notes

- SAM.gov requires a user-provided public API key.
- EU TED Search API is public and does not require a key for published notices.
- UK Contracts Finder returns OCDS data under the UK Open Government Licence.
