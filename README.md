# imoti-powered-mcp

## What it is

An unofficial assistant for personal use to search imot.bg, evaluate properties, and remember what matters to you. Describe a home in plain language; the assistant chooses filters, finds listings, reviews available photo and location evidence, and explains a shortlist. This project is not affiliated with or endorsed by imot.bg.

## Quick install

Requires Node.js 24 or newer, npm, Claude Code, and Chrome or Chromium for live browsing. From a repository checkout:

```sh
npm ci --include=dev
npm run build
claude --plugin-dir .
```

For the AI-assisted setup route, see [Install for AI](docs/install-for-ai.md).

## Quick usage

Ask Claude Code: “Find a two-bedroom apartment in Sofia under €350,000, within walking distance of the metro.” See the [user guide](docs/user-guide.md) for setup, examples, and result interpretation.

## Documentation

- [Install for AI](docs/install-for-ai.md) — guided setup
- [User guide](docs/user-guide.md) — usage and interpretation
- [Sample requests](docs/sample-requests.md)
- [Limitations](docs/limitations.md)
- [Maintainer live check](docs/maintainers/live-check.md)
- [Site permissions](docs/site-permissions.md)
- [Engineering](docs/engineering.md)

**Status: stage 5 implementation complete; Simon's final pets-policy live check pending.**

See [product limitations](docs/limitations.md) for coverage and uncertainty boundaries, and [site terms and image-use permissions](docs/site-permissions.md) for the dated source review and decisions required before distribution.

To refresh locally saved searches and watched listings while no chat session is open, run `npm run refresh --` from the
repository. See [`docs/maintainers/live-check.md`](docs/maintainers/live-check.md) for the owner live-check procedure and safe reporting guidance.

## Schedule local refreshes

Refresh is a one-shot command: each run checks saved searches and watched listings once, then exits. Schedules below run
only on this machine. The database, browser profile, credentials, and other user data remain local (outside the repository).
If a protective screen appears, refresh stops and requires manual continuation in a visible browser; neither schedule
continues unattended past it. Replace `/path/to/imoti-powered-mcp` with your checkout's absolute path.

### macOS (launchd)

Save this as `local.imoti-powered-mcp.refresh.plist` in the repository root, replacing the checkout path. This runs at
minute 0 and 30 of each hour (at least 30 minutes apart):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.imoti-powered-mcp.refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>npm</string>
    <string>run</string>
    <string>refresh</string>
    <string>--</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/imoti-powered-mcp</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Minute</key><integer>0</integer></dict>
    <dict><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>StandardOutPath</key>
  <string>/tmp/imoti-powered-mcp-refresh.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/imoti-powered-mcp-refresh.log</string>
</dict>
</plist>
```

Install and load it for your user:

```sh
mkdir -p ~/Library/LaunchAgents
cp /path/to/imoti-powered-mcp/local.imoti-powered-mcp.refresh.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/local.imoti-powered-mcp.refresh.plist
```

### Linux/macOS (cron)

Add this crontab entry to run at minute 15 and 45 each hour. The explicit `cd` selects the checkout, and output is
appended to a log file in the user's home directory:

```cron
15,45 * * * * cd /path/to/imoti-powered-mcp && npm run refresh -- >> "$HOME/.imoti-powered-mcp-refresh.log" 2>&1
```

Open with `crontab -e` and paste the line. Cron and launchd examples use different minutes so enabling both does not
normally start overlapping refreshes.

## Clean-checkout setup

Prerequisites: Node.js 24 or newer, npm, Claude Code to load the plugin, and an installed Chrome or Chromium executable for live browsing. `playwright-core` does not install or download a browser. From a clean checkout, run these exact commands:

```sh
npm ci --include=dev
npm run build
npm test
claude --plugin-dir .
```

When Claude Code asks which MCP server to use, the root `.mcp.json` exposes the project server `imoti`; that duplicate
must be declined. Use the plugin server `plugin:imoti-powered-mcp:imoti`.

In the Claude Code session, try: “Find a two-bedroom apartment in Sofia under €350,000, within walking distance of the metro.” See [`docs/sample-requests.md`](docs/sample-requests.md) for tool-call examples.

## Browser adapter

The browser adapter requires an installed Chrome or Chromium executable; `playwright-core` does not download a browser during installation. By default it uses the Chrome channel. Set `IMOTI_BROWSER_EXECUTABLE` (or pass `executablePath`) to use a specific browser executable. The persistent profile is stored at `IMOTI_DATA_DIR/profile` (default `~/.imoti-powered-mcp/profile`), outside the repository. Set `IMOTI_VISIBLE=1` to launch the browser visibly when a protective screen asks for human continuation. The adapter stops on protective screens and does not automate CAPTCHA or other challenges.

Search collection is bounded. `--max-results N` (or `IMOTI_SEARCH_MAX_RESULTS=N`) controls results, default 15, allowed range 10–20. `--max-pages N` (or `IMOTI_SEARCH_MAX_PAGES=N`) controls pages per search, default 3, allowed range 1–3. The CLI also accepts the legacy aliases `--limit` and `--pages`. MCP callers may set `criteria.startPage` (integer 1–26, default 1) to continue from a later site page; `criteria.maxPages` still caps each search at 3 consecutive pages. Structured results identify `contributingPages`, the pages represented in returned listings. The browser adapter retains its independent per-run ceiling of 20 pages (default); configured values cannot raise the search's 3-page cap. CLI flags override the corresponding environment defaults. MCP callers use `limit`, `criteria.startPage`, and `criteria.maxPages` in `search_listings` with the same bounds.

The browser launch path has not been checked in CI; it remains unchecked pending the owner's live run on a machine with Chrome or Chromium installed.

To inspect the MCP server manually, run:

```sh
npx @modelcontextprotocol/inspector node dist/main.js
```

## How changes land

Every change arrives as a pull request. It is reviewed and tested, and CI must pass before it is merged into `main`.
Simon owns the remaining release steps: run the owner live check and `claude plugin validate .` on his machine, resolve
the site-access and image-use permission decisions, then choose the release version, tag it, and publish the GitHub
release. See [`docs/maintainers/live-check.md`](docs/maintainers/live-check.md) for the reproducible checks and report template.

## License

[MIT](LICENSE)
