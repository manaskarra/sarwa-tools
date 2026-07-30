import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeepDive,
  buildHoldings,
  buildOverview,
  buildPortfolioView,
  buildTransactions,
  buildWatchlist,
  normalizeSymbol,
} from "../src/analytics.js";

const positionsResponse = {
  data: [
    {
      attributes: {
        asset_class: "us_equity",
        avg_entry_price: "50",
        cost_basis: "500",
        current_price: "60",
        market_value: "600",
        name: "Example Equity",
        qty: "10",
        symbol: "EXM",
        unrealized_intraday_pl: "10",
        unrealized_intraday_plpc: "0.02",
        unrealized_pl: "100",
        unrealized_plpc: "0.2",
      },
    },
    {
      attributes: {
        asset_class: "crypto",
        avg_entry_price: "50000",
        cost_basis: "500",
        current_price: "40000",
        market_value: "400",
        name: "Bitcoin",
        qty: "0.01",
        symbol: "BTC/USD",
        unrealized_intraday_pl: "-5",
        unrealized_intraday_plpc: "-0.01",
        unrealized_pl: "-100",
        unrealized_plpc: "-0.2",
      },
    },
  ],
};

const ordersResponse = {
  data: [
    {
      attributes: {
        commission: "1",
        filled_at: "2026-01-03T00:00:00Z",
        filled_avg_price: "50",
        filled_qty: "10",
        notional: 500,
        side: "buy",
        status: "filled",
        symbol: "EXM",
        total_value: 501,
      },
    },
    {
      attributes: {
        commission: "",
        filled_at: "2026-01-02T00:00:00Z",
        filled_avg_price: "40000",
        filled_qty: "0.005",
        notional: 200,
        side: "buy",
        status: "filled",
        symbol: "BTC/USD",
        total_value: 196,
      },
    },
    {
      attributes: {
        commission: "1",
        filled_at: "2026-01-01T00:00:00Z",
        filled_avg_price: "55",
        filled_qty: "2",
        notional: 100,
        side: "sell",
        status: "filled",
        symbol: "EXM",
        total_value: 101,
      },
    },
  ],
};

test("holdings normalize numeric strings without losing position details", () => {
  const holdings = buildHoldings(positionsResponse);
  assert.equal(holdings.length, 2);
  assert.deepEqual(holdings[0], {
    assetClass: "us_equity",
    averageEntryPrice: 50,
    costBasis: 500,
    currentPrice: 60,
    dailyPnl: 10,
    dailyPnlRatio: 0.02,
    marketValue: 600,
    name: "Example Equity",
    portfolioWeight: null,
    quantity: 10,
    symbol: "EXM",
    unrealizedPnl: 100,
    unrealizedPnlRatio: 0.2,
  });
});

test("overview distinguishes Sarwa-reported and calculated metrics", () => {
  const overview = buildOverview({
    ordersResponse,
    portfolioResponse: {
      balance_currency: "USD",
      earnings: 50,
      net_deposits: 1000,
      returns: { money_weighted: 0.04, simple: 0.05, time_weighted: 0.06 },
      value: 1050,
    },
    positionsResponse,
  });

  assert.equal(overview.reported.accountValue, 1050);
  assert.equal(overview.reported.totalPnl, 50);
  assert.equal(overview.calculated.holdingCount, 2);
  assert.equal(overview.calculated.holdingsMarketValue, 1000);
  assert.equal(overview.calculated.holdingsCostBasis, 1000);
  assert.equal(overview.reported.cash, 50);
  assert.equal(overview.calculated.unrealizedPnl, 0);
  assert.equal(overview.reported.dailyPnl, 5);
  assert.equal(overview.calculated.grossBuySpend, 701);
  assert.equal(overview.calculated.grossSellProceeds, 101);
});

test("deep dive matches BTC and BTC/USD without exposing order identifiers", () => {
  const result = buildDeepDive({
    ordersResponse,
    positionsResponse,
    symbol: "btc",
    transactionsResponse: {
      data: [
        {
          activity_type: "FILL",
          date: "2026-01-02T00:00:00Z",
          number_of_shares: 0.005,
          price_per_share: 40000,
          side: "buy",
          symbol: "BTC/USD",
          total_value: 200,
        },
      ],
    },
  });

  assert.equal(normalizeSymbol("btc/usd"), "BTC");
  assert.equal(result.symbol, "BTC");
  assert.equal(result.holding.symbol, "BTC/USD");
  assert.equal(result.orderSummary.orderCount, 1);
  assert.equal(result.orderSummary.grossBuySpend, 200);
  assert.equal(result.transactions.length, 1);
  assert.equal("id" in result.orders[0], false);
});

test("agent portfolio view is compact and uses percentage values", () => {
  const holdings = buildHoldings(positionsResponse);
  const overview = buildOverview({
    ordersResponse,
    portfolioResponse: {
      earnings: 50,
      net_deposits: 1000,
      returns: { simple: 0.05 },
      value: 1050,
      value_currency: "USD",
    },
    positionsResponse,
  });
  const view = buildPortfolioView(overview, holdings, 1);

  assert.equal(view.total_return_pct, 5);
  assert.equal(view.cash, 50);
  assert.equal(view.holdings.count, 2);
  assert.equal(view.holdings.top.length, 1);
  assert.equal(view.holdings.top[0].symbol, "EXM");
  assert.equal("calculationNotes" in view, false);
});

test("Trade account details override derived portfolio totals", () => {
  const overview = buildOverview({
    ordersResponse,
    portfolioResponse: {
      data: {
        attributes: {
          cash: 25,
          currency: "USD",
          earnings: 75,
          equity: 1075,
          intraday_p_and_l_amount: -12,
          net_deposits: 1000,
          returns: 0.075,
        },
      },
    },
    positionsResponse,
  });

  assert.equal(overview.reported.accountValue, 1075);
  assert.equal(overview.reported.cash, 25);
  assert.equal(overview.reported.dailyPnl, -12);
  assert.equal(overview.reported.totalPnl, 75);
  assert.equal(overview.reported.simpleReturnRatio, 0.075);
});

test("transactions and watchlists expose only decision-useful fields", () => {
  const transactions = buildTransactions({
    data: [
      {
        activity_type: "ORDER",
        date: "2026-01-02T00:00:00Z",
        id: "private-id",
        number_of_shares: 2,
        price_per_share: 50,
        side: "buy",
        symbol: "EXM",
        total_value: 100,
      },
    ],
  });
  const watchlist = buildWatchlist({
    data: [
      {
        attributes: {
          name: "Example",
          percentChange: 1.25,
          price: 42,
          symbol: "EXM",
          type: "us_equity",
        },
      },
    ],
  });

  assert.deepEqual(transactions[0], {
    amount: 100,
    asset_class: null,
    date: "2026-01-02T00:00:00.000Z",
    price: 50,
    quantity: 2,
    side: "buy",
    status: null,
    symbol: "EXM",
    type: "ORDER",
  });
  assert.equal("id" in transactions[0], false);
  assert.deepEqual(watchlist[0], {
    asset_class: "us_equity",
    change_pct: 1.25,
    name: "Example",
    price: 42,
    symbol: "EXM",
  });
});

test("financial fields fail closed instead of becoming plausible zeroes", () => {
  assert.throws(
    () =>
      buildHoldings({
        data: [
          {
            attributes: {
              asset_class: "us_equity",
              cost_basis: "500",
              current_price: "60",
              market_value: "not-a-number",
              qty: "10",
              symbol: "EXM",
              unrealized_pl: "100",
            },
          },
        ],
      }),
    (error) =>
      error.code === "UPSTREAM_SCHEMA_CHANGED" &&
      /market_value/.test(error.message),
  );
  assert.throws(
    () => buildTransactions({ unexpected: [] }),
    (error) => error.code === "UPSTREAM_SCHEMA_CHANGED",
  );
});

test("nested monetary values and Unix timestamps are normalized exactly", () => {
  const [transaction] = buildTransactions({
    data: [
      {
        activity_type: "ORDER",
        amount: { currency: "USD", value: 134.28 },
        created_at: "2025-10-30T12:50:10.747623Z",
        date: 1761828610,
        number_of_shares: 0.001,
        price_per_share: { currency: "USD", value: 110320.88 },
        side: "buy",
        symbol: "BTC/USD",
      },
    ],
  });

  assert.equal(transaction.amount, 134.28);
  assert.equal(transaction.price, 110320.88);
  assert.equal(transaction.date, "2025-10-30T12:50:10.747Z");
});

test("upstream zero-date sentinels are missing dates, not year-one activity", () => {
  const transactions = buildTransactions({
    data: [
      {
        activity_type: "DIV",
        amount: 7.23,
        created_at: "0001-01-01T00:00:00.000Z",
        date: "2026-07-29T00:00:00Z",
        symbol: "QQQM",
      },
      {
        activity_type: "DIV",
        amount: 5.57,
        created_at: "0001-01-01T00:00:00.000Z",
        symbol: "VXUS",
      },
    ],
  });

  assert.equal(transactions[0].date, "2026-07-29T00:00:00.000Z");
  assert.equal(transactions[1].date, null);
});

test("incomplete order history never reports a complete spend total", () => {
  const overview = buildOverview({
    ordersComplete: false,
    ordersResponse,
    portfolioResponse: {
      earnings: 50,
      net_deposits: 1000,
      value: 1050,
    },
    positionsResponse,
  });

  assert.equal(overview.calculated.grossBuySpend, null);
  assert.equal(overview.partial, true);
  assert.match(overview.warnings[0], /order history/i);
});
