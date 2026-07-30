import assert from "node:assert/strict";
import test from "node:test";

import {
  attachAgentWatchlist,
  buildMonitorState,
  diffMonitorStates,
  normalizeAgentSymbol,
  normalizeWatchlistNote,
  transactionFingerprint,
} from "../src/agent.js";

function snapshot({
  holdings = [],
  transactions = [],
  watchlist = [],
} = {}) {
  return {
    schema_version: "1.0",
    fetched_at: "2026-07-30T00:00:00.000Z",
    source_as_of: null,
    partial: false,
    warnings: [],
    snapshot: {
      portfolio: {
        cash: 100,
        total_pnl: 25,
        value: 1_000,
      },
      holdings,
      transactions,
      agent_watchlist: watchlist,
    },
  };
}

test("agent symbols and notes are normalized without terminal-control risk", () => {
  assert.equal(normalizeAgentSymbol(" btc/usd "), "BTC/USD");
  assert.equal(normalizeWatchlistNote(" long-term idea "), "long-term idea");
  assert.equal(normalizeWatchlistNote("   "), null);
  assert.throws(
    () => normalizeAgentSymbol("../../escape"),
    (error) => error.code === "USAGE",
  );
  assert.throws(
    () => normalizeWatchlistNote("unsafe\u001b[2J"),
    (error) => error.code === "USAGE",
  );
});

test("snapshot watchlist items are enriched with matching held positions", () => {
  const document = attachAgentWatchlist(
    snapshot({
      holdings: [{ quantity: 0.1, symbol: "BTC/USD", value: 6_000 }],
    }),
    [
      {
        added_at: "2026-07-30T00:00:00.000Z",
        note: "watch",
        symbol: "BTC",
        updated_at: "2026-07-30T00:00:00.000Z",
      },
    ],
  );

  assert.equal(document.snapshot.agent_watchlist[0].is_held, true);
  assert.equal(
    document.snapshot.agent_watchlist[0].holding.symbol,
    "BTC/USD",
  );
});

test("monitor diff detects new activity without confusing duplicate rows", () => {
  const originalTransaction = {
    amount: 50,
    date: "2026-07-29T00:00:00.000Z",
    price: 50,
    quantity: 1,
    side: "buy",
    status: "filled",
    symbol: "EXM",
    type: "ORDER",
  };
  const nextTransaction = {
    ...originalTransaction,
    amount: 75,
    date: "2026-07-30T00:00:00.000Z",
    price: 75,
    symbol: "NEW",
  };
  const previousDocument = snapshot({
    holdings: [
      { quantity: 1, symbol: "EXM" },
      { quantity: 0.1, symbol: "BTC/USD" },
    ],
    transactions: [originalTransaction, originalTransaction],
    watchlist: [{ symbol: "EXM" }],
  });
  const currentDocument = snapshot({
    holdings: [
      { quantity: 2, symbol: "EXM" },
      { quantity: 1, symbol: "NEW" },
    ],
    transactions: [
      nextTransaction,
      originalTransaction,
      originalTransaction,
    ],
    watchlist: [{ symbol: "NEW" }],
  });
  currentDocument.snapshot.portfolio = {
    cash: 75,
    total_pnl: 30,
    value: 1_050,
  };

  const previous = buildMonitorState(
    previousDocument,
    "2026-07-29T00:00:00.000Z",
  );
  const current = buildMonitorState(
    currentDocument,
    "2026-07-30T00:00:00.000Z",
  );
  const result = diffMonitorStates(previous, current, currentDocument);

  assert.equal(result.changed, true);
  assert.deepEqual(
    result.events.map((event) => event.type).sort(),
    [
      "position_closed",
      "position_opened",
      "position_quantity_changed",
      "transaction_added",
      "watchlist_added",
      "watchlist_removed",
    ],
  );
  assert.deepEqual(result.portfolio_delta, {
    cash: -25,
    total_pnl: 5,
    value: 50,
  });
  assert.equal(
    result.events.filter((event) => event.type === "transaction_added").length,
    1,
  );
  assert.equal(transactionFingerprint(originalTransaction).length, 64);
  assert.equal(
    new Set(result.events.map((event) => event.event_id)).size,
    result.events.length,
  );
});

test("identical new transaction rows receive stable occurrence identities", () => {
  const transaction = {
    amount: 50,
    date: "2026-07-30T00:00:00.000Z",
    price: 50,
    quantity: 1,
    side: "buy",
    status: "filled",
    symbol: "EXM",
    type: "ORDER",
  };
  const previousDocument = snapshot({ transactions: [] });
  const currentDocument = snapshot({
    transactions: [transaction, transaction],
  });
  const result = diffMonitorStates(
    buildMonitorState(previousDocument, "2026-07-29T00:00:00.000Z"),
    buildMonitorState(currentDocument, "2026-07-30T00:00:00.000Z"),
    currentDocument,
  );

  assert.deepEqual(
    result.events.map((event) => event.occurrence),
    [1, 2],
  );
  assert.equal(new Set(result.events.map((event) => event.event_id)).size, 2);
});
