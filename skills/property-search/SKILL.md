---
name: property-search
description: Turn a home-buying request into verified imot.bg search criteria, inspect promising listings, and explain evidence and uncertainty in a shortlist.
---

# Property search

Use `search_listings` for searches in Sofia. Translate the request into explicit criteria before calling it. Put only firm constraints in criteria; treat preferences as ranking or explanation guidance, not reasons to silently exclude a listing. The tool accepts criteria and an optional result `limit` (10–20, default 15). Districts are supplied by name. Convert stated price and area bounds into `priceMin`/`priceMax` and `areaMin`/`areaMax`.

Rooms count the living room. A request for two bedrooms normally means a three-room apartment (`3-СТАЕН`); verify the actual bedroom layout from the listing description rather than assuming the category proves it. Include requested property types and room bounds where appropriate. If district names are ambiguous or a desired constraint cannot be represented, explain that and keep it as a preference instead of inventing a filter.

Call `get_listing` for promising search results when the shortlist needs the full description, floor/layout details, VAT terms, parking costs, or other listing-page evidence. Use the returned listing id. Do not claim facts that the fields, description or photos do not support. If evidence conflicts, state the conflict.

For each shortlist entry, explain:

- the evidence supporting the match (including relevant structured fields and description);
- what is missing or contradictory;
- VAT treatment and parking costs when those are stated;
- the precision of the location provided (exact address, street, neighbourhood or unknown).

Call a price an **asking price**, never a sale price. If a listing later cannot be found, say it is **no longer observed**, not that it was sold. Do not infer or claim hidden defects from listing text or photos. Be clear when a preference such as walkability or renovation readiness has not been verified by available tools.

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
