# imoti-powered-mcp

A conversational assistant that searches imot.bg, evaluates properties and remembers what matters to the user. Describe the desired home in plain language; the assistant chooses filters, finds listings, reviews their photos and location, and explains its shortlist.

**Status: stage 2, in development (memory and monitoring).**

To refresh locally saved searches and watched listings while no chat session is open, run `npm run refresh --` from the
repository. See [`docs/live-check.md`](docs/live-check.md) for the owner live-check procedure and safe reporting guidance.

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
