# Sample property-search requests

These examples show the intended tool calls, not guaranteed results. The search tool supports Sofia criteria; describe unsupported preferences honestly instead of treating them as verified filters.

## Two-bedroom home near the metro

Request: “Find a two-bedroom apartment in Sofia under €350,000, within walking distance of the metro, suitable for moving in without major renovation. Avoid options similar to the ones I rejected.”

Call `search_listings` with the hard requirements. Two bedrooms usually map to three rooms because the living room is counted. Metro access, condition and rejected-listing similarity remain assessment/preferences unless evidence or saved rejection data is available.

```json
{
  "name": "search_listings",
  "arguments": {
    "criteria": {
      "deal": "sale",
      "city": "София",
      "districts": [],
      "propertyTypes": ["tristaen"],
      "rooms": { "min": 3, "max": 3 },
      "priceMax": 350000
    },
    "limit": 15
  }
}
```

For promising results, call `get_listing` with each result's `id` to inspect details needed for the explanation:

```json
{ "name": "get_listing", "arguments": { "id": "<result id>" } }
```

## Three-room apartment in Lozenets

Request: “Show me three-room apartments for sale in Lozenets, Sofia, priced from €180,000 to €300,000 and at least 90 square metres.”

```json
{
  "name": "search_listings",
  "arguments": {
    "criteria": {
      "deal": "sale",
      "city": "София",
      "districts": ["Лозенец"],
      "propertyTypes": ["tristaen"],
      "rooms": { "min": 3, "max": 3 },
      "priceMin": 180000,
      "priceMax": 300000,
      "areaMin": 90
    },
    "limit": 15
  }
}
```

## Small house in Bankya

Request: “Search for a house in Bankya up to €250,000, ideally with at least 120 square metres and a garden.”

```json
{
  "name": "search_listings",
  "arguments": {
    "criteria": {
      "deal": "sale",
      "city": "София",
      "districts": ["Банкя"],
      "propertyTypes": ["kashta"],
      "priceMax": 250000,
      "areaMin": 120
    },
    "limit": 15
  }
}
```

Treat the garden as a preference to verify in listing evidence; do not claim it is a filter unless the tool schema supports it. Check returned filter verification before presenting results.
