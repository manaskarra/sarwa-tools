# Sarwa CLI

An unofficial, read-only portfolio CLI for [Sarwa Odyssey](https://www.sarwa.co/trade).

It is intentionally small: portfolio, holdings, transactions, curated market
lists, and deterministic agent snapshots. There are no trading, funding,
raw-request, embedded LLM, or debug commands.

> Sarwa does not publish a supported Odyssey developer API. Internal endpoints
> may change. Use this only with your own account.

## Install

Requires Node.js 22.12+ and Chrome, Edge, or Chromium.

```bash
npm install -g github:manaskarra/sarwa-cli
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
successful run. It emits deterministic events for newly opened or closed
positions, quantity changes, new transactions, and local watchlist additions or
removals. Portfolio value, P&L, and cash changes are included as numeric deltas
without creating noisy events.

The first complete run creates a baseline and intentionally emits no historical
events. A partial or incomplete Sarwa read never advances that baseline. Use
`sarwa monitor --reset` to deliberately replace it without emitting events.

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

All Sarwa requests are authenticated `GET` requests. The CLI has no buy, sell,
cancel, deposit, withdrawal, or transfer capability. Treat terminal/JSON output
and the local monitor/watchlist state as sensitive financial data.

Run the local checks with:

```bash
npm run verify
```
