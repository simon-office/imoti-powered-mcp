# imoti-powered-mcp

A conversational assistant that searches imot.bg, evaluates properties and remembers what matters to the user. Describe the desired home in plain language; the assistant chooses filters, finds listings, reviews their photos and location, and explains its shortlist.

**Status: stage 2, in development (memory and monitoring).**

To refresh locally saved searches and watched listings while no chat session is open, run `npm run refresh --` from the
repository. See [`docs/live-check.md`](docs/live-check.md) for the owner live-check procedure and safe reporting guidance.

## Schedule local refreshes

Refresh is a one-shot command: each run checks saved searches and watched listings once, then exits. Schedules below run
only on this machine. The database, browser profile, credentials, and other user data remain local (outside the repository).
If a protective screen appears, refresh stops and requires manual continuation in a visible browser; neither schedule
continues unattended past it. Replace `/path/to/imoti-powered-mcp` with your checkout's absolute path.

### macOS (launchd)

Save this as `~/Library/LaunchAgents/local.imoti-powered-mcp.refresh.plist`, replacing the checkout path. This runs at
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

## Quick start

Install dependencies and build the MCP server, then load this repository as a Claude Code plugin. In the Claude Code session, try: “Find a two-bedroom apartment in Sofia under €350,000, within walking distance of the metro.” See [`docs/sample-requests.md`](docs/sample-requests.md) for the corresponding tool calls and more examples.

```sh
npm ci
npm run build
claude --plugin-dir .
```

## Build and test

Requires Node.js 24 or newer.

```sh
npm ci
npm run build
npm test
```

## Load in Claude Code

Build the server, then load this checkout as a plugin:

```sh
npm run build
claude --plugin-dir <repository>
```

## Browser adapter

The browser adapter requires an installed Chrome or Chromium executable; `playwright-core` does not download a browser during `npm ci`. By default it uses the Chrome channel. Set `IMOTI_BROWSER_EXECUTABLE` (or pass `executablePath`) to use a specific browser executable. The persistent profile is stored at `IMOTI_DATA_DIR/profile` (default `~/.imoti-powered-mcp/profile`), outside the repository. Set `IMOTI_VISIBLE=1` to launch the browser visibly when a protective screen asks for human continuation. The adapter stops on protective screens and does not automate CAPTCHA or other challenges.

The browser launch path has not been checked in CI; it remains unchecked pending the owner's live run on a machine with Chrome or Chromium installed.

To inspect the MCP server manually, run:

```sh
npx @modelcontextprotocol/inspector node dist/main.js
```

## How changes land

Every change arrives as a pull request. It is reviewed and tested, and CI must pass before it is merged into `main`.
Releases are made by the repository owner.

## License

[MIT](LICENSE)
