# Installation guide for AI assistants

Follow this guide with the user. Commands are run in a terminal on the user's machine; do not claim they ran unless their output is available. No installation test here makes network or browser requests.

## Prerequisites

Run these checks first:

```sh
node --version
npm --version
claude --version
```

Expected: Node.js 24 or newer, npm 11 (or a compatible npm supplied with Node), and a Claude Code version that supports plugins. On macOS/Linux, confirm a browser executable:

```sh
command -v google-chrome || command -v chromium || command -v chromium-browser
```

On Windows PowerShell, check common install locations:

```powershell
where.exe chrome
where.exe chromium
```

Expected: at least one installed Chrome or Chromium executable. `playwright-core` does not install or download a browser. If Node is too old, install Node 24 or newer and open a fresh terminal; re-run `node --version` and `npm --version`. If the browser is missing, stop and ask the user to install Chrome or Chromium before continuing. Never download a browser as part of this guide.

## Claude Code: clone, build, and persistent plugin install

Choose a parent directory, then clone the public repository and enter it:

```sh
git clone https://github.com/simon-office/imoti-powered-mcp.git
cd imoti-powered-mcp
```

Verification: `git status --short --branch` shows the checkout branch and no unexpected changes; the current directory is the repository root.

Install from the lockfile, build, and validate the plugin manifest:

```sh
npm ci --include=dev
npm run build
claude plugin validate .
```

Expected: dependency installation succeeds, TypeScript compilation exits 0, and plugin validation reports a valid plugin. If build fails, check `node --version`, rerun `npm ci --include=dev`, then `npm run build`. If validation fails, confirm you are at the repository root and inspect the reported manifest/path before retrying; do not install an invalid plugin.

Add this local checkout as a marketplace and install the plugin persistently:

```sh
claude plugin marketplace add .
claude plugin install imoti-powered-mcp@imoti-powered-mcp
```

Verification:

```sh
claude plugin list
```

Expected: `imoti-powered-mcp` appears as installed/enabled from the `imoti-powered-mcp` marketplace. If marketplace registration or validation fails, run `claude plugin validate .` again from the repository root and resolve its reported issue. Restart Claude Code and open a session outside the repository to verify the persistent install.

In a Claude Code session, call the plugin MCP tool `server_info`. Expected: a successful response includes the server version and the absolute data directory (normally under `~/.imoti-powered-mcp`). Confirm that only the plugin server `plugin:imoti-powered-mcp:imoti` is enabled; if Claude asks whether to use a duplicate project MCP server, decline the duplicate and keep the plugin server. There must be no duplicate MCP prompt on subsequent sessions. This repository intentionally has no root `.mcp.json` server registration.

For property-search tool selection and response behavior, follow [`skills/property-search/SKILL.md`](../skills/property-search/SKILL.md). It defines criteria, bounded search and the maximum of 3 result pages per search, evidence requirements, and uncertainty/coverage reporting. Do not imply complete coverage, infer unsupported facts, or suppress uncertainty.

## Claude Desktop alternatives

### Chat MCPB install

Download the project’s versioned `.mcpb` package from its GitHub release, then in Claude Desktop open **Settings → Extensions → Advanced settings → Install Extension** and select the downloaded MCPB. Accept the install prompt. Confirm the extension is listed and enabled, then start a chat and ask it to call `server_info`; verify the version and absolute data directory in its response. Use a package built for this project, not an arbitrary MCPB.

### Upload the skill

Download the versioned `property-search-skill-<version>.zip` release asset. In Claude Desktop, open **Customize → Skills → Upload skill** and upload that ZIP (it contains `SKILL.md` at the archive root). Enable the uploaded skill and verify it appears in the Skills list. The canonical instructions are [`skills/property-search/SKILL.md`](../skills/property-search/SKILL.md); preserve its search bounds, criteria, evidence and uncertainty rules.

### Manual MCP configuration (alternative)

Use this only if installing the MCPB is unsuitable. Build the project first. Add an `imoti-powered-mcp` entry to Claude Desktop's `claude_desktop_config.json`, replacing `/absolute/path/to/imoti-powered-mcp` with the actual absolute checkout path (Windows paths require escaped backslashes in JSON):

```json
{
  "mcpServers": {
    "imoti-powered-mcp": {
      "command": "node",
      "args": ["--disable-warning=ExperimentalWarning", "/absolute/path/to/imoti-powered-mcp/dist/main.js"],
      "env": { "IMOTI_DATA_DIR": "/absolute/path/to/user-data/.imoti-powered-mcp" }
    }
  }
}
```

Merge the entry into the existing `mcpServers` object; do not replace unrelated servers. Restart Claude Desktop, confirm the server shows connected, then call `server_info` and check its version and data directory. For Windows, set both paths to absolute Windows paths with JSON-escaped `\\` separators. Keep the data directory outside the checkout.

## Troubleshooting and safe stopping

- **Node is too old:** install Node 24+, open a new terminal, and repeat the prerequisite checks before reinstalling.
- **Browser is missing:** stop and ask the user to install Chrome or Chromium; then verify its executable is discoverable or set `IMOTI_BROWSER_EXECUTABLE` to its absolute path. Do not continue live browsing until installed.
- **Server does not connect:** if the server does not connect, verify the build completed, `dist/main.js` exists, `node --version` is 24+, and the configured working directory/absolute path is correct. Restart the host and check its MCP logs. For manual config, check the JSON parses and that `server_info` is available.
- **Build or marketplace validation fails:** run commands from the repository root, check the first reported error, confirm Node/npm versions, rerun `npm ci --include=dev`, then build and validate again. Do not install until both succeed.
- **Protective screen or CAPTCHA:** stop immediately. Tell the user a protective screen appeared and ask them to continue manually in a visible browser, then resume only after they say it is clear. Never solve, bypass, retry around, or automate a challenge.
