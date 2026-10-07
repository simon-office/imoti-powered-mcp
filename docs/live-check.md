# Owner live check (stage 1)

## Owner live check (stage 5: multilingual search coverage)

### Targeted continuation and page-spread check

On Simon's machine, issue the same broad sale/type criteria twice, first with `startPage: 1` and then with
`startPage: 4` (keep `maxPages: 3` and `limit: 10`). Confirm the second call requests pages 4–6, never more than
three URLs, and that `contributingPages` exactly matches the page numbers represented by returned listings. Compare
the first-page-heavy sample with the later-page sample; do not expect fixed listing identities or counts. Repeat once
with `propertyTypes: ["ednostaen", "dvustaen"]` and confirm both requested types remain interleaved while contributing
pages are reported. Use only the owner's live session. In the report, record redacted aggregate page numbers, returned
count, and type counts; omit listing IDs, URLs, titles, addresses, contacts, raw responses, screenshots, and page text.

### Property-type, omission, photo, and listing reconciliation

Run separate searches on Simon's live session for the `biznes-imot` and `promishleno-pomeshtenie` categories. Include
the business-card subtype titled «БАНКОВ ОФИС». For each returned card, compare its property-type slug and displayed
label with the selected category and the listing title; report mismatches as unresolved rather than inferring a match from
the title alone.

Run a search with a property-type filter that returns omitted cards. Record the returned omitted-card count and compare it
with the output. If zero results were returned, say that filters were not verified; an empty result is not evidence that
the requested filters worked.

Inspect standard 800×600 listing photos and confirm they do not receive a small-dimensions warning. For a returned
listing, call `get_listing` and confirm `get_listing.propertyType.slug` agrees with the property-type slug reported by
`search_listings`. Record only redacted counts and whether each comparison agreed.

For the final multilingual rounds, retain the checks for evidence-based facts and area context below, and verify that
the skill gives useful guidance for requests in English, Bulgarian, and Russian. Report commands/tool calls, runtime and
date, redacted results, mismatches, errors, unavailable checks, and remaining questions; do not report unrun checks as
passed or include identifying listing details.

### Final Stage 5 targeted re-checks

Keep the nine plain-language requests below verbatim and retain the final search, photo, comparison, area-context, and
evidence-based-facts guidance. In the same owner session, check each case below against the actual tool output and report
each as **PASS**, **FAIL**, or **NOT CHECKED**, with brief redacted evidence. A case is not a pass merely because it was
not exercised; explain unavailable inputs or runtime checks as not checked.

- Search for Izgrev and confirm the resolved district points to the correct ЖК feature, not a similarly named map feature.
- Check an ambiguous same-name ЖК candidate that is distant from the requested area: it must return no coordinates; confirm
  adjoining features that are appropriate to merge still merge. Record whether each candidate was correctly resolved or
  deliberately left without coordinates.
- When transit schedule data is unavailable, confirm the response says schedule/unavailability clearly while retaining
  the known stops; absence of a schedule must not erase stop data.
- Check street extraction on a result with description prose after the address: street extraction must exclude that trailing
  description prose rather than extending the street value.
- On a promotional rental result, compare promotional monthly rent, promotion duration, and regular monthly rent as
  separate values; confirm the output does not substitute one for another.
- Compare expected Act 16 completion with reached/actual Act 16 status and ensure the two are reported distinctly.
- Check a seller-source conflict and confirm the competing sources are surfaced as a conflict, not silently reconciled.
- On mixed result pages without a page URL type, verify business and industrial cards still receive the correct card URL
  typing from their card/category evidence, and verify the business subtype «БАНКОВ ОФИС» is preserved.

For every item, state the outcome and a short redacted reason. Do not include listing IDs, URLs, titles, addresses, seller
contacts, raw page content, photos, or copied listing text in the report. Continue to report the nine request rounds and
the existing search, photo, comparison, area-context, and facts checks independently; targeted cases do not replace them.

Run these nine plain-language requests in separate turns on Simon's machine with the stage 5 plugin and live site access.
These checks are not results: record only what the tools actually return. Use the requests verbatim, including their
language. There are five purchases and four rentals (three English, three Bulgarian, three Russian).

### Exact requests

1. **E1 buy (English):** Hi! We're relocating to Sofia next spring and want to buy a two bedroom apartment. Budget is about 200k euro. We don't know the city at all – somewhere safe, green, and not too far from the center would be great, ideally close to a metro station since we won't have a car. What would you suggest?
2. **E2 rent (English):** I just got a job at Business Park Sofia and need to rent a furnished one-bedroom flat, max 800 EUR per month. I have a cat. I'd like to walk or take a short ride to the office. Can you find something?
3. **E3 buy a house (English):** We want to buy a small house with a garden near Sofia, quiet area, max 250,000 euros. We don't mind commuting 30-40 minutes to the city. Any options?
4. **B1 buy (Bulgarian):** Здравейте, искам да купя апартамент в София за около 150 хиляди евро, с две спални. Нямам кола, затова ми трябва да е близо до метро. Не познавам добре кварталите, кое е добро за живеене?
5. **B2 rent, student (Bulgarian):** Търся квартира под наем за дъщеря ми, която ще учи в София. До 500 лева на месец, най-добре близо до Студентски град или някой университет. Какво има?
6. **B3 rent a house (Bulgarian):** Искаме да наемем къща или голям апартамент с двор в Бояна или Драгалевци, до 1500 евро на месец. Имаме две деца и куче.
7. **R1 buy to let (Russian):** Здравствуйте! Хочу купить квартиру в Софии, чтобы сдавать в аренду. Бюджет до 120 тысяч евро, однушка или двушка, желательно недалеко от центра или университета. Что посоветуете?
8. **R2 rent with a dog (Russian):** Ищу квартиру в аренду в Софии на длительный срок, двухкомнатную, с мебелью, до 900 евро в месяц. У нас собака, так что нужно чтобы хозяин разрешал животных, и хорошо бы рядом парк и метро.
9. **R3 buy a new build (Russian):** Мы с мужем хотим купить трёхкомнатную квартиру в новостройке в Софии, около 250 тысяч евро, в хорошем спокойном районе, где живёт много иностранцев. Подскажите варианты.

### Exact MCP calls and expected comparisons

For each turn send the verbatim request above, then compare the actual tool call with the matching input below. These are
the exact `search_listings` tool name, argument shape, and explicit search criteria; `limit: 15` is within the supported
10–20 range. The natural-language request remains authoritative for wishes the schema cannot express (furnished, pets,
garden, safety, green space, new build, and travel time); mark those wishes unverified unless returned evidence supports
them. In particular, do not mistake a Sofia-wide search for a validated district or proximity filter.

**E1 call**
```json
{"name":"search_listings","arguments":{"criteria":{"deal":"sale","city":"sofia","districts":[],"propertyTypes":["dvustaen"],"priceMax":200000,"maxPages":3},"limit":15}}
```
**E1 comparison:** expected to request a Sofia-wide sale search for `dvustaen` up to €200,000. Compare verified deal,
city, type and price with output; metro proximity and safe/green/central preferences are unverified unless supported.

**E2 call**
```json
{"name":"search_listings","arguments":{"criteria":{"deal":"rent","city":"sofia","districts":[],"propertyTypes":["ednostaen"],"priceMax":800,"maxPages":3},"limit":15}}
```
**E2 comparison:** expected to request a Sofia-wide rent search up to €800/month. Inspect actual type/price verification;
furnishing, cat acceptance and Business Park journey are unverified search wishes. Check the named-destination call below.

**E3 call**
```json
{"name":"search_listings","arguments":{"criteria":{"deal":"sale","city":"sofia","districts":[],"propertyTypes":["kashta"],"priceMax":250000,"maxPages":3},"limit":15}}
```
**E3 comparison:** expected to request the `kashta` house type specifically, for sale up to €250,000 in Sofia. Confirm
house type is present in verified coverage and returned results; garden, quietness and commute remain unverified wishes.

**B1 call**
```json
{"name":"search_listings","arguments":{"criteria":{"deal":"sale","city":"sofia","districts":[],"propertyTypes":["dvustaen"],"priceMax":150000,"maxPages":3},"limit":15}}
```
**B1 comparison:** expected to request a Sofia-wide two-room sale search up to €150,000. Check metro as a wish separately;
do not claim it was a filter unless a tool call actually provides that filter.

**B2 call**
```json
{"name":"search_listings","arguments":{"criteria":{"deal":"rent","city":"sofia","districts":["Студентски град"],"propertyTypes":[],"priceMax":255.65,"maxPages":3},"limit":15}}
```
**B2 comparison:** expected to request rent in Студентски град with the 500 BGN ceiling converted to €255.65/month
(500 ÷ 1.95583), plus inspect whether an additional university-area search was actually made. District resolution,
monthly unit, and original-to-euro conversion must be verified from the call and output; university proximity is not
implied by this district alone.

**B3 call**
```json
{"name":"search_listings","arguments":{"criteria":{"deal":"rent","city":"sofia","districts":["Бояна","Драгалевци"],"propertyTypes":["kashta","mnogostaen"],"priceMax":1500,"maxPages":3},"limit":15}}
```
**B3 comparison:** expected to request rent up to €1,500 in both named districts and both house and large-apartment types
at once. Verify every district and type in filter verification/coverage and note returned coverage; garden, children and
dog acceptance are unverified unless supported by results.

**R1 call**
```json
{"name":"search_listings","arguments":{"criteria":{"deal":"sale","city":"sofia","districts":[],"propertyTypes":["ednostaen","dvustaen"],"priceMax":120000,"maxPages":3},"limit":15}}
```
**R1 comparison:** expected to request both one-room and two-room sale types up to €120,000. Check both types in verified
coverage and whether results support them. Rental yield, center and university proximity are not established by this call.

**R2 call**
```json
{"name":"search_listings","arguments":{"criteria":{"deal":"rent","city":"sofia","districts":[],"propertyTypes":["dvustaen"],"priceMax":900,"maxPages":3},"limit":15}}
```
**R2 comparison:** expected to request two-room rent up to €900/month. Check type, deal and monthly euro ceiling; furniture,
dog permission and park preference need returned evidence. Metro is checked separately below.

**R3 call**
```json
{"name":"search_listings","arguments":{"criteria":{"deal":"sale","city":"sofia","districts":[],"propertyTypes":["tristaen"],"priceMax":250000,"maxPages":3},"limit":15}}
```
**R3 comparison:** expected to request three-room sale up to €250,000. Verify that type and price were applied; new-build,
quietness and international-neighbourhood wishes are unverified unless supported by returned evidence.

For nearest-metro and named-place checks, select a returned listing in the owner's private session and replace the made-up
sample ID; `area_context` only accepts a listing already stored locally. To check E1/B1/R2 metro output use:

```json
{"name":"area_context","arguments":{"listingId":"1c100000000000001","radiusMeters":1000}}
```

The comparison is the returned `nearestMetro` station and its `mode: metro`, not a nearby bus stop; distinguish the
straight-line nearest-station measurement from any pedestrian-route distance. For E2 destination distance, supply
Business Park Sofia's coordinates from an approved local source (do not guess coordinates):

```json
{"name":"area_context","arguments":{"listingId":"1c100000000000001","radiusMeters":1000,"destination":{"name":"Business Park Sofia","latitude":42.63,"longitude":23.38}}}
```

These coordinates are approximate call inputs, not evidence of a route; the output labels this distance straight-line.
Record location precision and mark actual route/time unverified. Redaction is applied to listing descriptions by the
tool; compare a privately viewed redacted result with its price and area, and confirm contacts alone are removed. Do not
copy either version into the report.

### Expected comparisons

For every turn inspect the `search_listings` calls and final answer against the original wishes; don't assume a wish was a
filter merely because it appears in prose. Check the verified filters and returned coverage, and mark each wish as
**verified**, **unverified**, or **not applicable** with brief redacted evidence. In particular:

- **District resolution:** check that every requested district resolves, including Student City/Студентски град, Бояна
  and Драгалевци, and record whether each resolves to an accepted district/filter. A suggested area is not proof that a
  requested district resolved.
- **Types:** E3 must search for houses. B3 requests a house or large apartment and yard; check coverage of several types
  at once and note which types were actually included and returned.
- **Sofia-wide totals:** for searches without a district constraint, compare the reported Sofia-wide total with the
  collected results, note which districts appear, whether coverage extends beyond the first alphabetical districts, and
  how many result pages were fetched. Do not expect fixed totals; live counts vary. A low collected count is not itself
  proof of completeness.
- **Rent normalization:** rentals must be interpreted as a monthly amount and reported in euros. For B2, verify conversion
  from leva at exactly 1.95583 leva per euro (500 leva ÷ 1.95583 ≈ €255.65/month); compare the original and normalized
  amount and ensure it remains monthly.
- **Redaction:** inspect redacted results and confirm redaction removes contacts only; prices and areas remain present and
  unchanged. Never expose a contact while making this comparison.
- **Metro:** for E1, B1 and R2, check the metro-stop mode and whether the nearest metro station is returned and plausibly
  matches the evidence. Distinguish a metro station from a bus stop and do not claim walking distance from straight-line
  distance.
- **Named destination:** verify the distance to a named place, Business Park Sofia for E2, and whether its basis/location precision is
  stated. Do not claim a route or travel time from a straight-line distance.

Coverage is **truncated** when the configured result/page limit is reached while more results or pages are indicated.
Coverage is **incomplete or unknown** when filters fail verification, a requested district does not resolve, a page fails,
a protective screen interrupts the search, page totals disagree, or the run cannot establish that all intended pages were
fetched. Record the page count and reason; never present a partial sample as a Sofia-wide exhaustive result. On a challenge,
stop automated access and continue only by the documented manual visible-browser procedure.

### Redacted owner result template

Fill only after running. Use request labels, aggregate counts and synthetic labels; do not include listing identifiers or
details that could identify a person or property.

| Request | Purchase/rent | Districts resolved | Types covered | Total / collected | District span | Pages fetched | Price unit/conversion | Redaction (contacts only; price/area retained) | Metro / destination check | Verified wishes | Unverified wishes | Coverage status / reason |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E1–R3 | | | | | | | | | | | | |

**Runtime/date:** ___  **Commands/tool calls (redacted):** ___  **Errors or unavailable checks:** ___

Never copy page text, personal data, contact details, photos, credentials or raw user data into reports. Do not include
listing URLs, exact addresses, raw tool responses, database/cache contents, screenshots, or page dumps. Share only
redacted aggregate evidence. These owner checks are not evidence until actually run and reported.

## Stage 4: release-candidate owner check

Run from a clean checkout on Simon's machine. These checks have not yet been run by the owner; do not treat this procedure
as evidence of a live result. Node 24+, npm, Claude Code and Chrome/Chromium are required for the applicable checks.

### Clean install and local checks

```sh
npm ci --include=dev
npm run build
npm test
claude plugin validate .
claude --plugin-dir .
```

In Claude Code, confirm the plugin appears in `/mcp` as `plugin:imoti-powered-mcp:imoti` and that its
`property-search` skill is available. The root `.mcp.json` exposes the project server `imoti`; that duplicate must be
declined. Use the plugin server `plugin:imoti-powered-mcp:imoti`. For the live workflow, call
`search_listings` for a two-bedroom apartment in Sofia under €350,000 near the metro, then call `save_note` and/or
`watch_listing` for a returned listing. Close the chat/session, run `npm run refresh --`, reopen the chat, and call
`get_changes` to inspect the resulting digest. See [`sample-requests.md`](sample-requests.md) for request examples.
Check tool output and skill guidance against returned evidence; do not infer a result when the site returns no matches or
a protective screen. If a challenge appears, stop automated access and continue manually in visible mode.

### Stage 4 checks

- Confirm search collection limits are configured as documented: `IMOTI_SEARCH_MAX_RESULTS` defaults to 15 and accepts
  10–20; `IMOTI_SEARCH_MAX_PAGES` defaults to 3 and accepts 1–3. Verify an explicit CLI limit overrides its environment
  default, and that the independent browser ceiling cannot exceed 20 pages.
- Check Sofia data cache behavior using `area_context`: a current cached dataset is reused; for a stale cached dataset,
  a refresh is attempted and the result reports refreshed or unavailable data accurately. Do not delete or share private
  cache files to manufacture a result.
- Use a listing whose coordinates are unavailable and confirm the response explicitly explains that coordinates are
  unavailable, rather than claiming a distance or silently using an imprecise location.
- Review [`limitations.md`](limitations.md) and [`site-permissions.md`](site-permissions.md). Confirm the documented
  precision/uncertainty boundaries and Simon's unresolved site-access and image-use permission decisions. The live check
  does not resolve those decisions or grant permission.
- Never share credentials, photos, exact addresses or raw user data.

### Owner report (fill only after running)

No result is pre-filled. Record Node version, OS, browser and Claude Code/runtime version; exact commands and tool calls;
redacted outcomes; errors; and provider cases not checked. Mark each check pass/fail/not checked and describe only
redacted evidence. Do not include credentials, photos, exact addresses, listing page dumps, database/cache contents or
raw user data.

| Check | Outcome (pass/fail/not checked) | Redacted evidence / error |
|---|---|---|
| Clean install/build/test | | |
| `claude plugin validate .` | | |
| Plugin loading and `/mcp` tool | | |
| `search_listings` → `save_note` and/or `watch_listing` → `npm run refresh --` → `get_changes` workflow | | |
| Configured collection limits | | |
| Current/stale Sofia cache behavior | | |
| No-coordinate explanation | | |
| Limitations and permission decision points | | |
| Provider cases not checked | | |

**Runtime:** Node ___; OS ___; browser ___; Claude Code/runtime ___; date/time ___
**Commands/tool calls:** ___
**Redacted outcomes and errors:** ___
**Provider cases not checked and why:** ___
**Owner decision / remaining release actions:** ___

Build the project, then run searches on the owner's machine with a normal browser available:

```sh
npm run search -- --type tristaen --price-max 350000 --area-min 70
npm run search -- --deal rent --price-max 1600 --district Lozenets
npm run search -- --district Iztok --district Lozenets --type dvustaen
```

Each search prints filter verification and listing rows, then saves the full structured response to
`$IMOTI_DATA_DIR/last-search.json` (default `~/.imoti-powered-mcp/last-search.json`). To use synthetic
HTML fixtures without a browser or network, add `--fixtures test/fixtures`. Listing details can be checked with
`npm run listing -- <id-or-url> [--refresh]`; `--visible` opens the browser visibly. If a protective screen appears,
stop and continue manually in visible mode; do not automate past it.

## Compare ten results visually

For ten returned listings, compare the CLI's structured data with each page and record whether each field agrees:

| Listing | Price | Area | Floor | District | Street precision | Photo count | Notes |
|---|---|---|---|---|---|---|---|
| 1–10 | | | | | | | |

Use the page as the reference. For street precision, record what is actually disclosed (exact address, street,
neighbourhood, or unknown); do not infer an exact location from a map pin or agency office. Count visible listing photos,
not thumbnails duplicated by the page layout.

## Report mismatches

If the CLI differs from the page, create an office task with the command and criteria used, listing id, field, CLI value,
observed page value, and a short explanation. Include the saved `last-search.json` as evidence when relevant. Use made-up
or redacted values in public examples; never attach personal data, browser profiles, credentials, photos, or page dumps.

# Owner live check (stage 2: memory and monitoring)

Build the project and start the plugin on the owner's machine with Chrome or Chromium installed. Use synthetic values below
or substitute listing IDs and criteria from your own private session. In the Claude Code session, make these MCP calls:

1. Save a search:

   ```json
   { "name": "save_search", "arguments": { "id": "stage2-live-check", "criteria": { "deal": "sale", "city": "София", "districts": ["Лозенец"], "propertyTypes": ["tristaen"], "rooms": { "min": 3, "max": 3 }, "priceMax": 350000 } } }
   ```

2. Add a note to a returned listing (replace the sample ID with one from your search):

   ```json
   { "name": "save_note", "arguments": { "listingId": "1c100000000000001", "kind": "note", "text": "Stage 2 live-check note" } }
   ```

3. Watch a listing:

   ```json
   { "name": "watch_listing", "arguments": { "listingId": "1c100000000000001", "watch": true } }
   ```

4. Close the Claude Code chat/session completely. From a terminal in the repository, run the local refresh command:

   ```sh
   npm run refresh --
   ```

   This uses the saved local data and refreshes saved searches and watched listings. It prints the counts refreshed and
   changes recorded. The database is under `$IMOTI_DATA_DIR/imoti.db` (default `~/.imoti-powered-mcp/imoti.db`). Do not
   run fixture mode for the live check; `--fixtures test/fixtures` is for offline synthetic testing only. If a protective
   screen appears, stop and continue manually in visible mode; do not automate past it.

5. Reopen the chat and inspect the change digest:

   ```json
   { "name": "get_changes", "arguments": { "limit": 100 } }
   ```

## Compare these observations

Record the following sequence and compare the change digest with the observations actually made:

- **First observation:** a listing first seen while saving/searching or refreshing starts local history at that observation.
  There is no inferred earlier price history and no fabricated price-change event before the first observation.
- **Changed asking price:** if a later refresh observes a different asking price, expect one `price_change` event with the observed
  old and new values.
- **Repeated unchanged refresh:** run `npm run refresh --` again without changing the listing. An unchanged observation may be
  stored, but it must add no duplicate change event.
- **Listing no longer observed:** when a previously observed search result is absent on a completed refresh, expect
  `no longer observed` / `disappeared`. Absence does not mean sold; absence is not sold evidence. Do not treat absence as sold, label it sold, or infer why it disappeared.

For a controlled comparison, note when each refresh ran and whether the asking price or search result presence actually
changed between runs. If the live site does not naturally provide a changed-price or missing-listing case during the check,
record that the case was not observed rather than manufacturing evidence.

## Report the live-check result

Record the date/time and runtime (Node version, OS, browser), exact commands used, whether chat was closed during refresh,
the saved-search/watch setup result, refresh stdout counts, and the `get_changes` event kinds/counts for each step. For any
event, include only the event kind and whether the observed values matched; use a synthetic or redacted listing identifier.
State which of the four comparisons were observed and which were unavailable, and note any error text needed to reproduce a
problem.

Do not include credentials, tokens, personal data, browser profiles, actual identifying listing details, photos, copied
listing pages, page dumps, or raw `last-search.json`/database contents in a report. Share only the minimum redacted output
needed to substantiate the result.

## Owner live check (stage 3: photo and location assessment)

Use two or more listings already returned by your own stage 1 search and stored locally. The IDs below are made-up examples;
replace them with IDs from your private session. These calls use the MCP tools exposed in the Claude Code session.

### Stage 3 check sequence

For each of the same two or more locally stored listings, inspect the compact output first, then expand the evidence as needed.
Check GTFS provenance and data availability; confirm that nearest-stop distance is explicitly straight-line, not walking
distance. For the boulevard assessment, verify the point and spread are constrained to the named neighbourhood and note the
neighbourhood used. Treat missing provenance or unavailable data as unavailable, not as a match.

1. Retrieve photo pages until every page has been checked. Each request is capped at 200,000 bytes. Record named low-resolution
   photos and inspect the full-size inventory's dimensions; compare inventory entries without saving or sharing image bytes.
   `get_listing_photos` also returns the deterministic photo assessment, configured provider findings and, when the host provider is
   selected, image content blocks for the host model. Follow `nextOffset` until null to cover all photo pages; do not collect
   or attach image content in your report.

   ```json
   { "name": "get_listing_photos", "arguments": { "listingId": "1c100000000000001", "offset": 0 } }
   ```

2. Ask for location precision, nearby stops and municipal context. The radius is in metres.

   ```json
   { "name": "area_context", "arguments": { "listingId": "1c100000000000001", "radiusMeters": 1000 } }
   ```

3. Compare the same locally stored listings, including their saved photo assessment, location evidence and asking-price
   positioning. This uses supplied asking prices, not completed-sale prices or a market-wide valuation.

   ```json
   { "name": "compare_listings", "arguments": { "listingIds": ["1c100000000000001", "1c100000000000002"] } }
   ```

### Provider configuration and evidence

Provider fallback order is: deterministic local checks and a configured local Ollama vision model; then a
free OpenRouter vision model when configured with the owner's own API key and free-model setting; finally the host model,
which receives image content blocks. Configure Ollama with `OLLAMA_ENDPOINT` and `OLLAMA_MODEL`; configure OpenRouter with
`OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (select a free vision model). If an earlier configured provider fails, the
assessment tries the next provider before host fallback. Keep the key local; never put credentials in a command transcript
or report. Record the provider actually named in the response.
For each returned photo or location/context source, inspect source/provenance, date or observation timestamp, and whether
the same reference/source is reused; note missing metadata as unavailable rather than guessing. For transit, record GTFS
provenance and availability. Review compact output and then the detailed evidence, including the straight-line nearest-stop
text and the neighbourhood-constrained boulevard point/spread, before drawing conclusions. If Ollama or OpenRouter is
unavailable, explicitly record that Ollama/OpenRouter were not checked when unavailable; do not imply either ran. Schedule joins were out of scope and not checked; do not test them as part of this live check.

### Manual labelled sample and owner-completed report

Simon should manually assess a small sample of photos and context results. For each photo, label whether the visible room,
finish and apparent renovation need are correctly characterized; whether any render is identified as render versus photo;
and whether image coverage is sufficient. For each listing's context, label location match and precision, and nearby-stop/
context accuracy. Use **correct**, **incorrect**, or **uncertain** per field, then report correct, incorrect, and uncertain
counts for each field. Hidden defects cannot be validated from photos.

Fill this template only after the owner's live run; counts and examples below are deliberately blank and are not results:

| Field | Correct | Incorrect | Uncertain | Unavailable | Redacted image reference / note |
|---|---:|---:|---:|---:|---|
| Visible room | — | — | — | — | — |
| Finish | — | — | — | — | — |
| Apparent renovation need | — | — | — | — | — |
| Render/photo | — | — | — | — | — |
| Coverage | — | — | — | — | — |
| Location match | — | — | — | — | — |
| Location precision | — | — | — | — | — |
| Nearby-stop/context accuracy | — | — | — | — | — |
| GTFS provenance and availability | — | — | — | — | — |
| Straight-line nearest-stop text | — | — | — | — | — |
| Boulevard point/spread in named neighbourhood | — | — | — | — | — |
| Named low-resolution photo / full-size dimensions | — | — | — | — | — |

**Owner-completed template:** date/time: ___; runtime (Node, OS, browser, Claude Code/model): ___; commit: ___;
commands/tool calls: ___; provider actually returned: ___; sample size: ___; per-field correct/incorrect/uncertain/unavailable
counts: use the table; Ollama/OpenRouter were not checked when unavailable (if applicable): ___; schedule joins out of scope/not
checked: yes; redacted image references: ___; errors: ___. Do not fabricate owner execution or outcomes. Exclude photo bytes,
exact addresses, credentials and personal data from reports and fixtures. Exclude photos, exact addresses, credentials and personal
data from any shared report. Never share photo bytes, exact addresses, or credentials. Share only redacted image
references and error text scrubbed of private values.

## Stage 5 area-evidence and guidance follow-up

On the next owner round, run the full local checks before opening Claude Code:

```sh
npm run build
npm test
claude plugin validate .
claude --plugin-dir .
```

Repeat the synthetic evidence checks in tests: a price field of 620 EUR versus a description saying 700 EUR, and a
listing district Младост 3 versus description Младост 4 must be reported as conflicts. For area context, confirm that
available nearby stops remain established when schedules fail; the schedule explanation must say schedules are
unavailable, not that nearby stops cannot be established. At neighbourhood precision, verify the explanation says
distances are from the neighbourhood centre. Check duplicate same-name ЖК./КВ. polygon resolution and the Оборище
address-point fallback through synthetic fixtures; do not use live listings or copy page content.

For the round's photo/fact checks, follow the stage 3 photo inventory and fact-verification procedure above. Compare
each factual result with its stated field/description evidence, mark photo observations correct/incorrect/uncertain, and
record unavailable results separately. Report date/time, commit, exact commands and tool calls, sample counts, checks
completed, failures, and redacted references using the owner-completed template. Do not report synthetic test outcomes as
owner live findings, and do not include photos, listing text, exact addresses or personal data.
