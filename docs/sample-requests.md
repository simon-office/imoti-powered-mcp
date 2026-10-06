# Sample property-search requests

These examples show the intended tool calls, not guaranteed results. The search tool supports Sofia criteria; describe unsupported preferences honestly instead of treating them as verified filters.

Prices below are synthetic. Search prices use EUR; rental amounts are EUR per month. When a request gives leva, convert by dividing by 1.95583 and explain the conversion. Reply in the language used by the requester.

## Buying and renting in English, Bulgarian and Russian

Each request demonstrates a valid `search_listings` input shape. User wording is intentionally synthetic.

### English — buy

Request: “Buy a two-bedroom flat in Sofia up to €220,000.” Two bedrooms normally mean three rooms.

```json
{"name":"search_listings","arguments":{"criteria":{"deal":"sale","city":"София","districts":[],"propertyTypes":["tristaen"],"rooms":{"min":3,"max":3},"priceMax":220000},"limit":10}}
```

### English — rent

Request: “Rent a furnished one-bedroom flat in Bankya for up to €700 per month.” Check furnishing in the description.

```json
{"name":"search_listings","arguments":{"criteria":{"deal":"rent","city":"София","districts":["Банкя"],"propertyTypes":["dvustaen"],"priceMax":700},"limit":10}}
```

### Bulgarian — покупка

Заявка: „Търся тристаен апартамент в София до 300 000 евро.“

```json
{"name":"search_listings","arguments":{"criteria":{"deal":"sale","city":"София","districts":[],"propertyTypes":["tristaen"],"rooms":{"min":3,"max":3},"priceMax":300000},"limit":10}}
```

### Bulgarian — наем

Заявка: „Търся двустаен под наем в Банкя до 900 лева на месец.“ Convert the maximum to about €460.02/month (900 ÷ 1.95583) and state this is approximate.

```json
{"name":"search_listings","arguments":{"criteria":{"deal":"rent","city":"София","districts":["Банкя"],"propertyTypes":["dvustaen"],"rooms":{"min":2,"max":2},"priceMax":460.02},"limit":10}}
```

### Русский — покупка

Запрос: «Ищу однушку в Софии до 120 000 евро.» Уточните, что «однушка» означает однокомнатную.

```json
{"name":"search_listings","arguments":{"criteria":{"deal":"sale","city":"София","districts":[],"propertyTypes":["ednostaen"],"rooms":{"min":1,"max":1},"priceMax":120000},"limit":10}}
```

### Русский — аренда

Запрос: «Снять двухкомнатную квартиру в Банкя до 800 евро в месяц.» «Квартира» может означать квартиру или комнату — уточните при необходимости.

```json
{"name":"search_listings","arguments":{"criteria":{"deal":"rent","city":"София","districts":["Банкя"],"propertyTypes":["dvustaen"],"rooms":{"min":2,"max":2},"priceMax":800},"limit":10}}
```

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

## Save a viewing note and watch a listing

After inspecting a result, save a short private note and add it to the watchlist. Replace the fabricated example id with an id returned by search:

```json
{ "name": "save_note", "arguments": { "listingId": "1c100000000000001", "kind": "viewing", "text": "Ask whether the building has a lift." } }
{ "name": "watch_listing", "arguments": { "listingId": "1c100000000000001", "watch": true } }
```

## Request a change digest

List recent saved listing changes, optionally restricting the digest to an ISO-8601 timestamp and a maximum number of events:

```json
{ "name": "get_changes", "arguments": { "since": "2026-01-01T00:00:00Z", "limit": 20 } }
```
