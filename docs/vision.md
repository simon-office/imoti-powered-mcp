# imot.bg Property Assistant — Product Vision

Personal pet project, designed for eventual publication on GitHub.

## Idea

A conversational assistant that searches imot.bg, evaluates properties and remembers what matters to the user. Describe the desired home in plain language; the assistant chooses filters, finds listings, reviews their photos and location, and explains its shortlist. No listing URLs required.

Example: “Find a two-bedroom apartment in Sofia under €350,000, within walking distance of the metro, suitable for moving in without major renovation. Avoid options similar to the ones I rejected.”

## Core scenarios

- **Search:** translate preferences into Bulgarian listing categories and site filters; distinguish hard requirements from preferences. A two-bedroom apartment typically maps to `3-СТАЕН`; verify the actual layout in the description.
- **Evaluate:** combine structured fields, description and photos; flag contradictions, missing information, VAT treatment and additional parking costs.
- **Understand Sofia:** assess transport, parks, schools, shops and access to user-defined destinations. State the precision of the location used.
- **Remember:** keep favourites, rejections, viewing notes and preferences locally; use them in subsequent searches.
- **Monitor:** detect new matches, price changes, edited descriptions and disappearing listings; prepare a concise digest.
- **Compare:** explain trade-offs and asking-price positioning among comparable listings. Generate questions for a viewing and identify possible reposts or duplicates.

## What the site check established

Browser inspection on 3 October 2026 confirmed that public search and a sampled listing were accessible without signing in. Search supports city, district, property type, price, area, floor and construction criteria. The tested Sofia / three-room / €350,000 query produced a results page. District selection did not apply on the first attempt: the adapter must verify the resulting filters.

The sampled listing exposed a stable listing ID, price, area, floor, construction details, description, street and 17 loaded photographs. This supports a browser-based prototype. Photo-analysis accuracy, exact coordinates and sustained unattended headless access remain unverified.

No suitable public listing-read API was established. The official API documentation found concerns importing listings. Plan around a browser adapter, with an API implementation replaceable later if a supported source becomes available.

## Proposed implementation

Package as a **Claude Code plugin**, containing skills and a local MCP server. Keep the core independent of Claude so another MCP client can reuse it.

| Component | Responsibility |
| --- | --- |
| Plugin skills | Interpret requests, choose tools, compare evidence and explain recommendations |
| MCP server | Expose property-specific tools with validated inputs and structured outputs |
| Playwright adapter | Navigate search and listing pages, verify filters, extract fields and image URLs |
| SQLite | Store listings, timestamped observations, searches, watchlists and private notes |
| Photo analysis | Provide selected listing images to the host's vision model; cache structured findings |
| Sofia data adapter | Combine transport and geographic datasets with geocoding and routing |
| Local scheduler | Refresh watched searches and listings while the chat is closed |

Suggested stack: TypeScript, MCP SDK, Playwright and SQLite. Start with one local process and a scheduled CLI command; introduce a persistent worker only when needed. Use a separate browser profile with persistent session data and an optional visible mode for manual intervention.

Suggested MCP tools: `search_listings`, `get_listing`, `get_listing_photos`, `compare_listings`, `area_context`, `save_note`, `save_search`, `watch_listing`, `get_changes`.

The model determines search strategy and interprets evidence. The adapter performs repeatable site operations. Return actual images or accessible image content to the model, rather than assuming it can inspect image URLs.

## Data and assessment rules

- Preserve original values, normalized values, source URL and observation time. Keep listing identity separate from a suspected physical-property identity.
- Record location precision: exact address, street, neighbourhood or unknown. Never treat an agency's office address as the property's address.
- Photo findings should identify rooms, visible finish, apparent renovation needs, renders and missing coverage; include image references and uncertainty. Hidden defects cannot be established from photos.
- Use official Sofia GTFS for stops and schedules, municipal geographic datasets for relevant infrastructure, and an appropriate pedestrian-routing source. Check dataset dates and reuse terms.
- Missing listings mean “no longer observed”, not “sold”. Local price history starts at first observation; any external history needs its own provenance.
- Market comparisons concern advertised prices, not completed transactions. Show sample size and observation period.

## Delivery plan

1. **End-to-end search prototype:** free-text request → verified filters → 10–20 extracted listings → explained shortlist. Manually check filter correctness and extraction quality.
2. **Memory and monitoring:** SQLite snapshots, notes, saved searches, incremental refresh and change digest. Verify that repeated checks do not create duplicate events.
3. **Photo and location assessment:** analyse shortlisted properties; evaluate accuracy on a small manually labelled sample. Show uncertainty when photos or addresses are incomplete.
4. **Public plugin release:** reproducible setup, sample requests, parser fixtures, documented limitations and configurable collection limits.

The first useful release should complete one search, remember feedback and produce a reliable change digest. Broader market coverage can follow.

## Operating boundaries

Use bounded searches, caching and conservative refresh frequency. On CAPTCHA or a protective screen, pause the affected operation and allow manual continuation; automatic bypass is not a dependency. A protective screen appeared in a third-party calculator iframe during inspection, while the main listing remained accessible.

Store user data, browser profiles and credentials outside the repository. Publish code and synthetic fixtures, not a scraped photo archive. Review site terms and image-use permissions before public distribution; browser accessibility is not permission to redistribute content.

## References

- [imot.bg search](https://www.imot.bg/search/prodazhbi)
- [Tested search results](https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/tristaen?price_max=350000)
- [Sample inspected listing](https://www.imot.bg/obiava-1c178038934668511-prodava-tristaen-apartament-grad-sofiya-iztok-bul-tsarigradsko-shose)
- [imot.bg terms](https://www.imot.bg/obshti-uslovia) · [Import API documentation](https://api.imot.bg/import_doc/)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins) · [Playwright persistent contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Sofia GTFS](https://urbandata.sofia.bg/dataset/gtfs-static) · [Sofiaplan open data](https://sofiaplan.bg/api/)
