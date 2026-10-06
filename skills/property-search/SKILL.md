---
name: property-search
description: Turn English, Bulgarian or Russian buying and renting requests into verified imot.bg searches, inspect promising listings, and explain evidence and uncertainty in the user's language.
---

# Property search

Use `search_listings` for searches in Sofia. Support buying (`deal: "sale"`) and renting (`deal: "rent"`); answer in the user's language (English, Bulgarian or Russian). Translate the request into explicit criteria before calling it. Put only firm constraints in criteria; treat preferences as ranking or explanation guidance, not reasons to silently exclude a listing. The tool accepts criteria and an optional result `limit` (10–20, default 15). Districts are supplied by name; call `get_search_districts` to discover valid district names and slugs before using an uncertain district. Promoted cards that do not match requested criteria are excluded from returned listings; when present, they are reported in `excludedPromoted`. `priceMin`/`priceMax` are EUR amounts; rent is EUR per month. If the user gives leva, convert using 1 EUR = 1.95583 BGN (divide leva by 1.95583) and state the conversion.

Rooms count the living room. A request for two bedrooms normally means a three-room apartment (`3-СТАЕН`); verify the actual bedroom layout from the listing description rather than assuming the category proves it. Include requested property types and room bounds where appropriate. If district names are ambiguous or a desired constraint cannot be represented, explain that and keep it as a preference instead of inventing a filter.

For one bedroom use `dvustaen` (двустаен, two rooms including the living room); «трёхкомнатная» maps to `tristaen`. A new-build request («новостройка») is not proof of completion: inspect explicit construction evidence and report Акт 14, Акт 15 or Акт 16 only when stated. The valid `propertyTypes` slugs are: `ednostaen`, `dvustaen`, `tristaen`, `chetiristaen`, `mnogostaen`, `mezonet`, `atelie-tavan`, `etazh-ot-kashta`, `kashta`, `vila`, `garazh-parkomyasto`, `ofis`, `magazin`, `zavedenie`, `sklad`, `promishleno-pomeshtenie`, `hotel`, `biznes-imot`, `partsel`, and `staya` (rent-only rooms; «стаи»). `partsel` is sale-only. Do not invent other slugs.

An English “one-bedroom” means `dvustaen` (двустаен), because the living room counts as a room.

Treat “about/around” budgets as approximate (roughly ±10%) unless the user confirms a hard cap. Ask whether the rent is for a short or long lease when the term matters; lease term is not extracted as a search field and must be checked in the description. Auction requests need explicit auction evidence; never treat an asking price as a bid or auction result.

Search geography is limited to Столична община (Sofia municipality), including its catalogued districts, villages and vacation zones. For a named landmark, first call `get_search_districts` to identify nearby valid search districts, then use `area_context` with the landmark's host-supplied destination coordinates to assess straight-line distance. If the user does not know the city, call `get_search_districts` and use `area_context` for a destination they name (for example work or study) before suggesting areas. Boyana-related names include Бояна, м-т Гърдова глава and в.з.Бояна; check them separately in the catalog.

Safety, greenery, parks and schools are not search filters or guarantees. Use returned area evidence for nearby parks/schools and explain that it cannot establish safety, greenery quality, school quality or walking access without suitable evidence. Broad results can be truncated and promoted-first; narrow or repeat the search by district and report that coverage remains incomplete.

Russian «квартира» is ambiguous: it can mean a flat/apartment or a room; clarify if needed. Translate layout conventions carefully: “two-bedroom” / “две спални” normally maps to `тристаен` (three rooms); Russian «двухкомнатная» maps to `двустаен` (two rooms); «однушка» maps to `едностаен` (one room). Room counts include the living room. Whether a rental is furnished, allows pets, and states the deposit, commission and lease duration are description checks, not guaranteed search filters; inspect `get_listing` and report when the description is silent.

Call `get_listing` for promising search results when the shortlist needs the full description, floor/layout details, VAT terms, parking costs, or other listing-page evidence. Use the returned listing id. Do not claim facts that the fields, description or photos do not support. If evidence conflicts, state the conflict.

Use `area_context` when the user asks about nearby transit, parks, schools or shops; state the location precision and any unavailable data. Use `get_listing_photos` when photos could help assess visible condition or layout, and state coverage/uncertainty. Use `compare_listings` to compare a shortlist on evidence and asking-price positioning. Use `save_note` for a user-requested private viewing/preference note, `save_search` when they ask to remember search criteria, and `watch_listing` when they ask to monitor a listing. Do not save or watch implicitly.

For each shortlist entry, explain:

- the evidence supporting the match (including relevant structured fields and description);
- what is missing or contradictory;
- VAT treatment and parking costs when those are stated;
- the precision of the location provided (exact address, street, neighbourhood or unknown).

Call a price an **asking price**, never a sale price. If a listing later cannot be found, say it is **no longer observed**, not that it was sold. Do not infer or claim hidden defects from listing text or photos. Be clear when a preference such as walkability or renovation readiness has not been verified by available tools.

Searches are bounded and may be truncated by page/result limits. Report the returned count, limit and any truncation/coverage metadata; say “among the results checked” and never imply that the search covered every available listing.

## Worked example

Request: “Find a two-bedroom apartment in Sofia under €350,000, within walking distance of the metro, suitable for moving in without major renovation. Avoid options similar to the ones I rejected.”

Interpretation: hard requirements are Sofia, apartment, two bedrooms (normally three rooms), and maximum €350,000. Metro access and move-in condition are preferences to assess from available evidence. The rejected-listing constraint cannot be evaluated unless saved rejection data is available; do not imply that it was applied.

Call:

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

Then call `get_listing` for each promising result, using its returned `id`:

```json
{
  "name": "get_listing",
  "arguments": { "id": "<result id>" }
}
```

Example explanation: “This listing is within the €350,000 asking-price ceiling and is listed as three-room in Sofia. Its description identifies two bedrooms and reports a renovated interior. The listing does not state VAT treatment or a separate parking cost. Location is identified to neighbourhood precision, so metro walking time is unverified. I could not compare it with rejected listings because no rejection data was available.”
