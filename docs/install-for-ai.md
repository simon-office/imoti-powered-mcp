# Installation guide for AI assistants

Follow this guide with the user. Commands run on the user's machine; never claim they ran unless their output is available. Ask for explicit user consent before installing a user-scope plugin or editing Claude Desktop configuration. No build or install step needs a browser or accesses the network except the stated GitHub clone/release downloads and package installation.

## Prerequisites

Run these checks:

```sh
node --version
npm --version
claude --version
```

Expected: Node.js 24 or newer, npm 11 (or compatible npm supplied with Node), and Claude Code with plugin support. This guide was tested with **Claude Code 2.1.76**.

Check for a browser executable. A browser is for live searches, not for build or install.

macOS: check both standard application locations and the executable on PATH:

```sh
test -d "/Applications/Google Chrome.app" && echo "Google Chrome app found"
test -d "/Applications/Chromium.app" && echo "Chromium app found"
command -v google-chrome || command -v chromium || command -v chromium-browser
```

For example, the executable path may be set as:

```sh
IMOTI_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

Windows PowerShell: check common Program Files locations:

```powershell
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Chromium\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Chromium\Application\chrome.exe"
)
$candidates | Where-Object { Test-Path $_ }
```

Linux: check PATH:

```sh
command -v google-chrome || command -v chromium || command -v chromium-browser
```

If Node is below 24, stop; ask the user to install Node 24+ and open a fresh terminal, then repeat version checks. If no browser is found, stop and ask the user to install Chrome or Chromium before a live search. Never download or install a browser as part of build/plugin installation. If a protective screen or CAPTCHA appears, stop and ask the user to continue manually in a visible browser; never bypass or automate around it.

## Claude Code: clone, build, validate, and install

Choose a parent directory and clone the repository:

```sh
git clone https://github.com/simon-office/imoti-powered-mcp.git
cd imoti-powered-mcp
```

Build from the lockfile and validate both the manifest and plugin directory:

```sh
npm ci --include=dev
npm run build
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .
```

Expected: dependency install and build exit successfully; each validation reports that the manifest/plugin is valid (success, no validation errors). If any command fails, stop and resolve that failure; do not proceed to marketplace registration or install.

Register this exact checkout as a marketplace:

```sh
claude plugin marketplace add "$PWD"
```

Only continue if its output contains the exact text `Successfully added marketplace`. If it does not, stop and report the output to the user; do not run the install command. Ask for the user's consent before the following user-scope installation:

```sh
claude plugin install imoti-powered-mcp@imoti-powered-mcp
```

The local marketplace source is keyed to its version, so after updating the checkout use the update procedure below; keep the checkout at the same path so Claude Code can find that source.

Primary verification, without requiring a logged-in Claude Code session:

```sh
claude mcp list
```

Expected: `plugin:imoti-powered-mcp:imoti … ✓ Connected` and this is the only imoti entry. If it is absent, duplicated, or not connected, stop and inspect the reported status instead of installing duplicates. Restarting Claude Code is the user's action; ask them to restart, then rerun the list command.

As a second check only in a logged-in Claude Code session, ask Claude to call `server_info`; a successful response includes server version and absolute data directory. This second check does not replace `claude mcp list`. Avoid duplicate MCP registrations; the project intentionally has no root `.mcp.json` server configuration.

## Update an existing checkout and plugin

Preserve the checkout path registered as the marketplace source. In that checkout, pull, install exactly from the lockfile, build, update the marketplace, then uninstall and reinstall the version-keyed plugin in this order:

```sh
git pull
npm ci --include=dev
npm run build
claude plugin marketplace update imoti-powered-mcp
claude plugin uninstall imoti-powered-mcp@imoti-powered-mcp
claude plugin install imoti-powered-mcp@imoti-powered-mcp
```

Ask for user consent before uninstall/reinstall because these are user-scope plugin changes. Verify afterward with `claude mcp list` as above. If the checkout path changes, the registered local marketplace source may no longer resolve; retain the original path or ask the user to deliberately re-register the new path.

## Claude Desktop alternatives

### MCPB extension

Download the versioned `.mcpb` asset from this project's GitHub Releases page (the release assets are published there). Install it in Claude Desktop via **Settings → Extensions → Advanced settings → Install Extension**, selecting that asset. Claude Desktop's bundled/built-in Node runs the `.mcpb`; a separate Node executable setting is not required for this package. Ask before the user confirms the installation. Check the extension's connected status in **Settings → Extensions**; optionally call `server_info` from a logged-in chat.

### Upload the search skill

Download the versioned `property-search-skill-<version>.zip` asset from this project's GitHub release. In Claude Desktop, open **Customize → Skills → Upload skill**, upload the ZIP (it contains `SKILL.md` at its root), enable it, and verify it appears in the Skills list. The canonical instructions are [`skills/property-search/SKILL.md`](../skills/property-search/SKILL.md).

Follow that skill's criteria, bounded-search, evidence, and uncertainty guidance when using the property tools.

### Manual MCP configuration

Use this only if MCPB installation is unsuitable. Build the project first. Before editing, ask the user for consent and make a backup first: back up `claude_desktop_config.json`. Find the absolute Node executable path with `which node` (or the platform's equivalent) and confirm `node --version` is 24+. Replace both example paths below with absolute paths; retain the warning flag. `IMOTI_DATA_DIR` is optional and should point outside the checkout.

```json
{
  "mcpServers": {
    "imoti-powered-mcp": {
      "command": "/absolute/path/from-which-node",
      "args": ["--disable-warning=ExperimentalWarning", "/absolute/path/to/imoti-powered-mcp/dist/main.js"],
      "env": { "IMOTI_DATA_DIR": "/absolute/path/to/user-data/.imoti-powered-mcp" }
    }
  }
}
```

Merge the entry into the existing `mcpServers`; do not replace unrelated servers. After the user-approved edit, fully quit Claude Desktop and reopen it. Check connection status in **Settings → Extensions**. For Windows, use absolute Windows paths and JSON-escaped backslashes. Keep user data outside the checkout.

## Troubleshooting and safe stopping

- **Build or validation fails:** stop. Check the first reported error, confirm Node/npm versions, then retry `npm ci --include=dev`, build, and both validation commands. Do not register/install until all succeed.
- **Marketplace add did not print `Successfully added marketplace`:** stop; do not install. Share the output and ask the user how to proceed.
- **Browser is missing:** stop and ask the user to install Chrome/Chromium before a live search. No browser is needed for installation.
- **Protective screen/CAPTCHA:** stop immediately, tell the user, and ask them to continue manually in a visible browser. Never solve, bypass, retry around, or automate a challenge.
- **Server does not connect:** check that build completed, the configured absolute paths are correct, and Node is 24+ when using manual configuration. Ask the user to restart Claude Code/Desktop, then check `claude mcp list` (Code) or **Settings → Extensions** (Desktop). Use `server_info` only as the secondary check in a logged-in session.
