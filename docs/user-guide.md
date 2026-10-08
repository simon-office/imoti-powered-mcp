# User guide

This guide covers the local plugin in Claude Code CLI, Claude Desktop's Code tab, and Claude Desktop chat. It describes the repository's supported local setup and generated packages; it does not mean the live site, browser launch or any listing fact has been verified on your computer. See [product limitations](limitations.md) before relying on results.

## Prerequisites and checks

- Node.js **24 or newer** and npm. Check with `node --version` and `npm --version`; if Node reports a version below `v24`, install a current Node 24+ release and reopen your terminal before installing/building.
- An installed Chrome or Chromium browser for live searches. `playwright-core` does not download a browser. Check that Chrome/Chromium starts on your system; if it is installed in a nonstandard location, set `IMOTI_BROWSER_EXECUTABLE` to its absolute executable path.
- Claude Code is needed for the CLI and Code-tab routes. Claude Desktop is needed for either Desktop route.

From a repository checkout, install the locked dependencies and compile the server:

```sh
npm ci --include=dev
npm run build
npm test
```

The repository's `.claude-plugin/marketplace.json` is a local marketplace containing this plugin. No global installation is required for local use.

## Claude Code CLI: persistent local marketplace install

Clone and build the repository, then register its absolute path as a local marketplace and install the plugin persistently for your user:

```sh
git clone https://github.com/simon-office/imoti-powered-mcp.git
cd imoti-powered-mcp
npm ci --include=dev
npm run build
claude plugin marketplace add "$PWD"
claude plugin install imoti-powered-mcp@imoti-powered-mcp
```

Start or restart Claude Code and check `/plugin` for the installed `imoti-powered-mcp` plugin. Try: “Find a two-bedroom apartment for sale in Sofia up to €220,000.” The plugin translates this to a three-room search (rooms include the living room) and explains the evidence and limits. This persistent route uses the marketplace manifest; `claude --plugin-dir .` is a temporary per-session alternative when run from the built checkout.

### Update or remove the CLI plugin

To update after pulling changes into the same checkout, rebuild, then refresh the marketplace/plugin from Claude Code:

```sh
git pull
npm ci --include=dev
npm run build
claude plugin marketplace update imoti-powered-mcp
```

If your Claude Code version does not expose that marketplace update subcommand, remove and re-add the local marketplace using `/plugin` and the checkout path, then install the plugin again. To remove, use `/plugin` to uninstall `imoti-powered-mcp`; remove the local marketplace entry there as well. Deleting the checkout alone does not uninstall the registered plugin.

## Claude Desktop Code tab

The Code tab uses Claude Code's plugin environment, so use the same prerequisites and local marketplace install above on the machine running Claude Desktop. Open the Code tab, open a project/workspace, and start a Claude Code session there; the local marketplace plugin should appear in that session's plugin list. If the host's labels differ by version, use its plugin/session controls to select the installed plugin. Confirm a small search request works before relying on it. This describes the Code-tab Claude Code route; it is separate from adding an MCP server to ordinary Desktop chat.

Update by rebuilding the checkout and refreshing the local marketplace as in the CLI section. Remove the plugin and marketplace from Claude Code's plugin controls; the Code tab itself does not keep a separate copy.

## Claude Desktop chat

There are two generated archives. Build both from the repository after installing dependencies:

```sh
npm ci --include=dev
npm run package:release
```

The command creates `release/imoti-powered-mcp-0.2.0-rc.1.mcpb` (the version changes with the manifest) and `release/property-search-skill-0.2.0-rc.1.zip`.

### Install the MCP server with the `.mcpb`

In Claude Desktop, use its extension installation flow to open the generated `.mcpb` file, review and confirm the local server installation, then enable it for chat. Exact menu labels vary by Desktop version; locate the Extensions/install-from-file control if present. Start a new chat and ask a simple Sofia property search. Confirm the `imoti` server is connected in Desktop's MCP/server status controls.

To update, rebuild and install the newly generated `.mcpb` using Desktop's extension update/reinstall controls. To remove, disable and uninstall the extension using those controls. This archive bundles the built server and its production dependencies.

### Upload the property-search skill ZIP

Use Desktop's skill management/upload interface to upload `property-search-skill-<version>.zip` and enable the skill. It teaches the host how to formulate property searches, but **does not install the MCP server**. For actual property tools, also install the `.mcpb` or configure the manual server below. Test a request and check that the skill is enabled and the MCP server is connected.

To update, upload the newly generated ZIP and replace/disable the old skill version using Desktop's skill controls. To remove, disable and delete the skill there. Skill-management labels depend on the Desktop version.

### Manual `claude_desktop_config.json` server alternative

Build the repository and use absolute paths for both `node` and the entry-point. Configuration locations are:

| Platform | Configuration file |
| --- | --- |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Merge this server entry into the existing JSON (preserve other settings), replacing both example paths with absolute paths on your computer:

```json
{
  "mcpServers": {
    "imoti": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/imoti-powered-mcp/dist/main.js"]
    }
  }
}
```

Restart Claude Desktop, then check its MCP/server status for `imoti` and try a small search. Update by pulling/replacing the checkout, running `npm ci --include=dev` and `npm run build`, then restarting Desktop. Remove by deleting only the `imoti` entry from `mcpServers` and restarting; keep other server entries intact.

## Using the tools and memory

The `property-search` skill supports buying (`sale`) and renting (`rent`) in Sofia municipality. It answers in English, Bulgarian or Russian and treats only firm criteria as filters. All six examples below are synthetic user requests; prices are asking-price limits, and rent amounts are monthly.

| Language | Buy | Rent |
| --- | --- | --- |
| English | “Buy a two-bedroom flat in Sofia up to €220,000.” | “Rent a furnished one-bedroom flat in Bankya for up to €700 per month.” |
| Bulgarian | „Търся тристаен апартамент в София до 300 000 евро.“ | „Търся двустаен под наем в Банкя до 900 лева на месец.“ |
| Russian | «Ищу однушку в Софии до 120 000 евро.» | «Снять двухкомнатную квартиру в Банкя до 800 евро в месяц.» |

Two bedrooms normally mean three rooms because the living room counts. Bulgarian leva are converted at 1 EUR = 1.95583 BGN and the approximate conversion should be stated. See [sample requests](sample-requests.md) for representative tool-call shapes.

Available tools include `get_search_districts` (valid district names), `search_listings`, `get_listing` (full listing evidence), `get_listing_photos`, `area_context`, and `compare_listings`. Memory tools are explicit: `save_note` stores a private note, `save_search` remembers criteria, and `watch_listing` adds/removes a listing from monitoring. `get_changes` returns observed changes. Nothing is saved or watched unless you ask.

The database, caches and browser profile stay local under `IMOTI_DATA_DIR`, default `~/.imoti-powered-mcp` (database: `imoti.db`; profile: `profile`). To reset all local state, stop Desktop/Claude Code and any refresh job, then delete that data directory. This permanently removes saved notes, searches, watches, cached data and the browser profile. Set `IMOTI_DATA_DIR` first if you configured a different location.

Refresh is a one-shot operation, not a continuously running service:

```sh
npm run refresh --
```

It checks saved searches and watched listings once, records observed changes, then exits. To schedule it, use a user-owned scheduler such as the examples in [README](../README.md#schedule-local-refreshes). Jobs run on that machine only and should be spaced responsibly. They stop when a protective screen requires human continuation; scheduling does not bypass it.

## Troubleshooting

- **Chrome/Chromium not found:** install Chrome or Chromium. If already installed at a nonstandard path, set `IMOTI_BROWSER_EXECUTABLE=/absolute/path/to/chrome` (or the platform's equivalent environment-variable syntax) and restart the host. This points to an existing browser; it does not download one.
- **Protective screen or CAPTCHA:** the operation pauses. Set `IMOTI_VISIBLE=1`, retry, and continue manually in the visible browser as the human. The software does not solve or bypass the screen. Do not schedule unattended continuation.
- **Server disconnected:** confirm Node 24+ is available to the host process (`node --version` in the same environment), rebuild with `npm run build`, verify the configured checkout/entry path and absolute paths, then restart Claude Desktop or Claude Code and inspect its server/plugin status. A terminal's PATH can differ from a desktop application's PATH.
- **Node.js older than 24 / `tsc` missing:** check `node --version`, install Node.js 24+, reopen the terminal and rerun `npm ci --include=dev` then `npm run build`. `--include=dev` is needed because TypeScript is a development dependency.
- **No results or uncertain evidence:** searches are bounded and may be incomplete; a missing result is not proof that a property is sold. Read [product limitations](limitations.md) and report only evidence the tools returned.
