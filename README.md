# Global Government Contracts & Tenders Scraper

Search official public procurement opportunities from US, EU, and UK government sources in one normalized dataset. This Actor helps vendors, consultants, proposal teams, and researchers monitor public-sector contracts and tenders with clean fields for buyers, deadlines, values, categories, locations, and official source URLs.

This Actor currently supports:

- **UK Contracts Finder** via the official OCDS API
- **EU TED** via the official TED Search API
- **SAM.gov** via the official Get Opportunities Public API when you provide your own SAM.gov API key

It atomically saves and charges each clean contract/tender record, skips duplicates, and stops later sources and keywords when the user's spending limit is reached.

## What This Actor Extracts

- Source
- Keyword used
- Contract or tender ID
- Contract title
- Buyer / contracting authority
- Country and region
- Notice type and stage
- Procurement method
- Contract value and currency where available
- Published date
- Deadline date
- Status
- CPV, NAICS, or classification codes
- Description
- Official contract URL
- Scraped timestamp

The output is focused on public procurement records and organization-level opportunity data. It does not intentionally collect personal contact lists, private account data, or non-public information.

## Use Cases

1. Government contract and tender monitoring for vendors.
2. Public-sector opportunity tracking for proposal and capture teams.
3. Procurement market research by category, region, buyer, and value.
4. Competitive intelligence for consultants and public-sector vendors.
5. Contract analytics across the UK, EU, and US public-sector markets.

## Input

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

To include SAM.gov, add `"sam_gov"` to `sources` and provide `samApiKey`.

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

## Output Example

```json
{
  "source": "uk_contracts_finder",
  "keyword": "software",
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
  "publishedDate": "2026-06-12T10:00:00+01:00",
  "deadlineDate": "2026-07-12T12:00:00+01:00",
  "status": "active",
  "classificationCodes": ["CPV:72000000 IT services"],
  "description": "Public contract notice summary...",
  "contractUrl": "https://www.contractsfinder.service.gov.uk/Notice/...",
  "scrapedAt": "2026-06-13T17:00:00.000Z"
}
```

## Pricing

| Event | Price | When charged |
| --- | ---: | --- |
| `contract-scraped` | `$0.004` | Once per clean contract/tender record saved |

## Responsible Use

Use this Actor only for lawful purposes and in compliance with the source websites' terms, robots.txt, applicable privacy laws, and local regulations. This Actor is designed for official public procurement records and does not intentionally collect personal contact lists, private account data, or non-public information.

## Notes

- SAM.gov requires a user-provided public API key.
- EU TED Search API is public and does not require a key for published notices.
- UK Contracts Finder returns OCDS data under the UK Open Government Licence.
