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
