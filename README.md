# Sarwa Tools

An unofficial, read-only Sarwa CLI, MCP server, and Node API for humans,
scripts, and AI agents using [Sarwa Odyssey](https://www.sarwa.co/trade).

It is intentionally small: portfolio, holdings, transactions, curated market
lists, and deterministic agent snapshots. There are no trading, funding,
raw-request, embedded LLM, or debug commands.

> Sarwa does not publish a supported Odyssey developer API. Internal endpoints
> may change. Use this only with your own account.

## Install

Requires Node.js 22.12+ and Chrome, Edge, or Chromium.

```bash
npm install -g sarwa-tools
sarwa auth login
```

Sign-in happens in a dedicated local browser profile. The CLI never asks for,
reads, prints, or stores your password. The browser keeps the Sarwa session and
refreshes short-lived authorization automatically; run `sarwa auth login` again only
if Sarwa expires the browser session.

If a managed Chrome installation blocks browser automation, install Playwright's
compatible Chrome for Testing build. The CLI detects it automatically:

```bash
npx playwright-core@1.62.0 install chromium
sarwa auth status
```

You can instead set `SARWA_BROWSER_EXECUTABLE` to the absolute path of an
unmanaged Chrome, Edge, or Chromium executable.

## Commands

```bash
sarwa                 # portfolio summary (same as `sarwa portfolio`)
sarwa portfolio       # value, P&L, deposits, spend, cash, top holdings
sarwa holdings        # current positions, largest first
sarwa watchlist       # Sarwa's most-popular market list
sarwa transactions    # latest portfolio activity
sarwa snapshot        # portfolio, holdings, activity, and local watchlist
sarwa monitor --once  # changes since the last complete snapshot
sarwa auth login      # sign in or refresh the browser session
sarwa auth status     # inspect local session state
sarwa auth logout     # remove the local browser session
```

Useful filters:

```bash
sarwa holdings --sort pnl --limit 10
sarwa holdings --sort return --asset-class crypto
sarwa watchlist --name top-movers --limit 10
sarwa transactions --symbol BTC --limit 20
sarwa holdings BTC    # one-asset deep dive
sarwa portfolio --schema
```

Manage a private watchlist for your local agent without changing anything in
Sarwa:

```bash
sarwa watchlist list
sarwa watchlist add NVDA --note "Watch earnings and position sizing"
sarwa watchlist remove NVDA
```

`sarwa watchlist` without a subcommand remains Sarwa's curated market list.
Local watchlist writes are stored atomically in the CLI's private configuration
directory with user-only permissions.

If more than one open Trade account exists, the CLI reports the available IDs;
select one with `--account ID`.

## MCP server

The package includes a local stdio MCP server for agents. It uses the same
secure browser session and deterministic portfolio documents as the CLI; it
does not contain or configure an LLM.

Authenticate once outside MCP:

```bash
sarwa auth login
```

Then configure an MCP host to launch `sarwa-mcp`:

```json
{
  "mcpServers": {
    "sarwa": {
      "command": "sarwa-mcp"
    }
  }
}
```

### Headless Linux and VPS hosts

`sarwa auth login` intentionally opens a visible browser so the user completes
Sarwa sign-in and MFA directly. On a headless server, perform this one-time step
through a temporary trusted VNC or X11 session as the same unprivileged Unix user
that will run the MCP host. Login is not exposed as an MCP tool.

Before logging in, configure a working Secret Service/Libsecret or KWallet
session for that user. [Chromium can fall back][chromium-password-storage] to
its unencrypted `basic` password store when no OS credential store is available.
Close the temporary graphical session after login, then verify both
authentication and session persistence:

```bash
sarwa auth status --json
sarwa snapshot --json
# Reboot the host, then run both commands again.
```

For a service-managed MCP host, use absolute paths for Node and
`bin/sarwa-mcp.js`, set `SARWA_CONFIG_DIR` explicitly, and keep the configuration
directory private. Do not run the browser or MCP server as root.

[chromium-password-storage]: https://chromium.googlesource.com/chromium/src/+/master/docs/linux/password_storage.md

The server exposes tools for authentication status, accounts, portfolio,
holdings, holding detail, transactions, Sarwa-curated market lists, the private
agent watchlist, snapshots, monitor checks, and an explicit destructive monitor
reset. It intentionally exposes no login, logout, trading, funding, raw-request,
or LLM tools.

Each authenticated tool call owns and closes its browser session, so a
long-running MCP host does not retain the browser-profile lock between calls.
MCP calls are serialized inside the server to keep local profile and monitor
state deterministic. Programmatic Node consumers can import MCP construction
from `sarwa-tools/mcp`; the default `sarwa-tools` export remains independent
of the MCP SDK.

## Agent output

Output is automatically structured JSON when piped or captured:

```bash
sarwa portfolio | jq
sarwa holdings | jq '.holdings[] | {symbol, value, pnl}'
sarwa transactions --symbol SPYM | jq
sarwa snapshot | jq '.snapshot'
sarwa monitor --once | jq '.monitor.events'
```

Use `--json` to force formatted JSON or `--compact` for one-line JSON:

```bash
sarwa --json portfolio
sarwa --compact holdings
```

Successful machine responses include stable `schema_version`, `fetched_at`,
`source_as_of`, `partial`, and `warnings` fields plus a resource-specific field
such as `portfolio` or `holdings`. Errors include `schema_version` and `error`,
and exit with 1 (request/data error) or 2 (authentication required).

### Snapshot and monitor

`snapshot` opens one authenticated browser session and returns a coherent
agent-ready document containing:

- portfolio totals and top positions;
- all current holdings;
- up to 100 recent transactions by default;
- transaction coverage metadata;
- the local watchlist, enriched with matching held positions.

Use `sarwa snapshot --all-transactions` when the caller needs the complete
available activity history.

`monitor --once` compares the latest complete snapshot with the previous
successful run for the same Trade account. Account IDs are hashed into private,
account-scoped baseline filenames, so monitoring multiple accounts cannot
compare or overwrite unrelated portfolios. It emits deterministic events for
newly opened or closed positions, quantity changes, new transactions, and local
watchlist additions or removals. Portfolio value, P&L, and cash changes are
included as numeric deltas without creating noisy events.

Each event ID is scoped to the observation that produced it, so repeated real
transitions remain distinct while replaying the same observation remains
idempotent. If overlapping monitor runs finish out of order, an older
or duplicate observation is reported as stale and cannot replace the newer
baseline.

The first complete run creates a baseline and intentionally emits no historical
events. A partial or incomplete Sarwa read never advances that baseline. Use
`sarwa monitor --reset` to deliberately replace it without emitting events.
Version 1.1.0 introduces account-scoped baseline files, so the first monitor run
per account after upgrading initializes a new baseline.

The CLI does not call or configure an LLM. An external agent such as Hermes can
schedule `sarwa --compact monitor --once`, parse the versioned JSON, and perform
its own analysis or notification logic.

## Metric meanings

- `value`, `total_pnl`, `net_deposits`, `day_pnl`, and `cash` come from Sarwa's
  Trade account summary.
- Holding value and unrealized P&L come from Sarwa's current positions.
- `gross_buy_spend` sums filled buy orders returned by Odyssey. It is cumulative
  cash outlay, not current cost basis or realized P&L.
- `sarwa watchlist` assets are Sarwa-curated. `sarwa watchlist list/add/remove`
  manages a separate, local-only agent list.

## Safety

All Sarwa requests are authenticated `GET` requests. The CLI and MCP server
have no buy, sell, cancel, deposit, withdrawal, or transfer capability. The MCP
server listens only on local stdio; it opens no network port. Configure it only
in agents you trust, and treat terminal, JSON, MCP output, and local
monitor/watchlist state as sensitive financial data.

Run the local checks with:

```bash
npm run verify
```
