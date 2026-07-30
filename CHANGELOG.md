# Changelog

## Unreleased

## 1.1.1 - 2026-07-30

- Treat Sarwa's year-one transaction timestamp as a missing date and fall back
  to another valid upstream timestamp when available.
- Describe nullable transaction dates explicitly in the agent/MCP schema.
- Keep the CLI and MCP release identity aligned with the npm package version.
- Describe the interactive login and credential-store requirements for
  headless Linux and VPS deployments without overclaiming the storage backend.

## 1.1.0 - 2026-07-30

- Add a local stdio MCP server with validated tools for authentication status,
  accounts, portfolio, holdings, transactions, market lists, snapshots,
  monitoring, and the private agent watchlist.
- Keep Sarwa access read-only and expose only explicit local-watchlist writes.
- Return structured, versioned MCP results and safe application errors without
  leaking internal failure details.
- Share snapshot and monitor orchestration between the CLI and MCP adapter.
- Scope monitor baselines to a hashed Trade account identifier so multiple
  accounts cannot be compared or overwrite one another.
- Cancel active browser work when an MCP call or transport closes, serialize
  every tool operation, and validate transaction dates before reading data.
- Advertise MCP output envelopes and isolate programmatic MCP imports behind
  the `sarwa-tools/mcp` package subpath.
- Rename the project, repository, and npm package to `sarwa-tools` while keeping
  the `sarwa` and `sarwa-mcp` executable names stable.

## 1.0.1 - 2026-07-30

- Prefer an installed Playwright Chrome for Testing build over managed system browsers.
- Fail fast with actionable guidance when browser automation is blocked or times out.
- Correct the documented machine-output shape and normalize the npm binary path.
- Make schemas discoverable on every local-watchlist leaf command without
  mutating local state.
- Add an agent-ready, single-session `snapshot` command with explicit transaction coverage.
- Add an atomic private local watchlist with `list`, `add`, and `remove` commands.
- Add a stateful one-shot monitor for positions, transactions, watchlist changes, and portfolio deltas.
- Preserve the last complete monitor baseline when any upstream read is partial.
- Reject stale overlapping monitor observations, scope event IDs to their
  observation, and preserve distinct punctuation-bearing instrument symbols.
- Suggest the intended command for common top-level typos.

## 1.0.0 - 2026-07-30

- Focused read-only portfolio, holdings, transactions, watchlist, and account commands.
- Stable agent JSON schemas and concise terminal output.
- Persistent browser authentication with secure migration and profile locking.
- Pagination, retries, structured errors, strict financial validation, and terminal sanitization.
