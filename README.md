# Sarwa CLI

An unofficial, read-only portfolio CLI for [Sarwa Odyssey](https://www.sarwa.co/trade).

It is intentionally small: portfolio, holdings, curated watchlists, and
transactions. There are no trading, funding, raw-request, or debug commands.

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

## Commands

```bash
sarwa                 # portfolio summary (same as `sarwa portfolio`)
sarwa portfolio       # value, P&L, deposits, spend, cash, top holdings
sarwa holdings        # current positions, largest first
sarwa watchlist       # Sarwa's most-popular market list
sarwa transactions    # latest portfolio activity
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

If more than one open Trade account exists, the CLI reports the available IDs;
select one with `--account ID`.

## Agent output

Output is automatically structured JSON when piped or captured:

```bash
sarwa portfolio | jq
sarwa holdings | jq '.holdings[] | {symbol, value, pnl}'
sarwa transactions --symbol SPYM | jq
```

Use `--json` to force formatted JSON or `--compact` for one-line JSON:

```bash
sarwa --json portfolio
sarwa --compact holdings
```

Every machine response uses a stable `schema_version`, `ok`, `resource`,
`data`, `meta`, and `warnings` envelope. Errors use the same envelope and exit
with 1 (request/data error) or 2 (authentication required).

## Metric meanings

- `value`, `total_pnl`, `net_deposits`, `day_pnl`, and `cash` come from Sarwa's
  Trade account summary.
- Holding value and unrealized P&L come from Sarwa's current positions.
- `gross_buy_spend` sums filled buy orders returned by Odyssey. It is cumulative
  cash outlay, not current cost basis or realized P&L.
- Watchlists are Sarwa-curated market lists, not private custom favorites.

## Safety

All Sarwa requests are authenticated `GET` requests. The CLI has no buy, sell,
cancel, deposit, withdrawal, or transfer capability. Treat terminal/JSON output
as sensitive financial data.

Run the local checks with:

```bash
npm run verify
```
