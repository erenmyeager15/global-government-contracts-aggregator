# Global Government Contracts Promotion Notes

## YouTube Tutorial Title Options

- How to Track Government Contracts and Tenders with Apify
- Scrape UK, EU and US Public Procurement Opportunities into One Dataset
- Build a Government Tender Lead Feed from UK Contracts Finder, EU TED and SAM.gov

## 60-Second Tutorial Script

1. Show the actor page: "This actor searches official public procurement sources and normalizes contracts and tenders into one dataset."
2. Open the input form and keep `uk_contracts_finder` plus `ted` selected.
3. Add one keyword such as `software` or `cybersecurity`.
4. Set a small date range and `maxResults` to `10`.
5. Run the actor.
6. Show the dataset table fields: `buyerName`, `buyerCountry`, `deadlineDate`, `contractValue`, `classificationCodes`, and `contractUrl`.
7. Open a record and point out the official source URL.
8. Export to CSV or connect the dataset to the Apify API.
9. Closing line: "Use this to monitor public-sector opportunities without checking multiple procurement portals manually."

## Short Post Copy

I polished a Global Government Contracts & Tenders Scraper on Apify.

It searches official procurement sources such as UK Contracts Finder and EU TED by default, and can include SAM.gov when you provide your own SAM.gov API key.

The output is normalized for public-sector opportunity tracking: buyer, country, region, deadline, status, estimated value, classification codes, description, and official tender URL.

Useful for vendors, consultants, proposal teams, capture teams, and procurement market research.

Example input:

```json
{
  "sources": ["uk_contracts_finder", "ted"],
  "keywords": ["software"],
  "noticeStatus": "active",
  "maxResults": 10
}
```

## SEO Keywords

- government contracts scraper
- tenders scraper
- public procurement data
- UK Contracts Finder scraper
- EU TED scraper
- SAM.gov opportunities scraper
- government tender leads
- Apify procurement scraper

## Promotion Guard

Before heavier public promotion, run one tiny paid verification only if budget allows or if the monitor flags this actor. For now, use the polished README and sample copy for light, honest replies or draft content.
