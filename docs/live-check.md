# Owner live check (stage 1)

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
