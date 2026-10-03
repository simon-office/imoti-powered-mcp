# Engineering conventions

## Stack and layout

Use strict TypeScript with ES modules for Node 24 or newer. Compile `src/` to `dist/` with NodeNext module semantics. The planned layout is `src/server.ts` for `createServer`, `src/main.ts` for the stdio entry point, and focused `src/tools/`, `src/adapter/`, `src/parsers/`, `src/search/`, `src/storage/`, and `src/cli.ts` modules. Keep tests in `test/`, synthetic HTML under `test/fixtures/`, plugin skills in `skills/`, and product documents in `docs/`; plugin metadata belongs in `.claude-plugin/plugin.json` and `.mcp.json`.

## Boundaries and test data

Parsers accept HTML (or bytes decoded from windows-1251) and do not fetch. Adapters perform fetching and do not parse. Tools coordinate adapters, parsers and storage; storage is accessed through a small repository interface. The CLI should reuse tool logic. Fixtures must be invented, obviously fake examples: do not commit copied site text, photographs or page dumps. During stage 1, pages must not be mined for personal phone numbers or email addresses; identify a seller only by agency name or as a private seller.

## Local data and site behaviour

Keep the database, caches, browser profile, credentials and all other user data outside the checkout in `IMOTI_DATA_DIR`, defaulting to `~/.imoti-powered-mcp`. Ignore local data paths. Searches are bounded (three result pages by default); requests have at least a two-second delay and use a time-to-live cache. If a CAPTCHA or protective screen appears, stop that operation, explain the screen and tell the user how to continue in visible mode. Never automate a bypass.

Photo assessment is a later-stage feature and must not rely on a paid external model. Prefer deterministic local checks and a locally running Ollama vision model; next use a free OpenRouter vision model with the user's own key; otherwise return image content blocks to the host model. Include image references and uncertainty in findings; do not claim hidden defects.

## Runtime and delivery

The supported runtime is Node 24, npm 11, Debian 13, without a browser or C/C++ compiler. Use `playwright-core` only; installation must not download a browser. Tests must not use the network, browser or native builds. MCP protocol output uses stdout; logs go to stderr only.

Every pull request needs tests for its acceptance criteria, a green `npm test`, no unrequested dependencies, no secrets, and no changes under `.github/`. Build and test locally before handoff, and describe the change and verification in the PR.
