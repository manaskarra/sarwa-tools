import { createHash } from "node:crypto";

import { SarwaError } from "./errors.js";

const AGENT_SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,31}$/;
const NOTE_MAX_LENGTH = 500;
const QUANTITY_EPSILON = 1e-10;

export function normalizeAgentSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!AGENT_SYMBOL_PATTERN.test(symbol)) {
    throw new SarwaError(
      "USAGE",
      "Symbol must be 1-32 characters using letters, numbers, dot, slash, underscore, or hyphen.",
      { retryable: false },
    );
  }
  return symbol;
}

export function normalizeWatchlistNote(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const note = String(value).trim();
  if (note.length > NOTE_MAX_LENGTH) {
    throw new SarwaError(
      "USAGE",
      `Watchlist note cannot exceed ${NOTE_MAX_LENGTH} characters.`,
      { retryable: false },
    );
  }
  if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(note)) {
    throw new SarwaError(
      "USAGE",
      "Watchlist note cannot contain terminal control characters.",
      { retryable: false },
    );
  }
  return note || null;
}

export function attachAgentWatchlist(snapshotDocument, watchlistItems) {
  const holdings = snapshotDocument?.snapshot?.holdings || [];
  const items = watchlistItems.map((item) => {
    const holding =
      holdings.find((candidate) =>
        symbolsMatch(candidate, item.symbol),
      ) || null;
    return {
      ...item,
      is_held: Boolean(holding),
      holding,
    };
  });
  return {
    ...snapshotDocument,
    snapshot: {
      ...snapshotDocument.snapshot,
      agent_watchlist: items,
    },
  };
}

export function buildMonitorState(snapshotDocument, capturedAt) {
  const snapshot = snapshotDocument?.snapshot;
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !validAgentTimestamp(capturedAt) ||
    !validAgentTimestamp(snapshotDocument.fetched_at)
  ) {
    throw new SarwaError(
      "INTERNAL_ERROR",
      "Monitor requires a valid agent snapshot.",
      { retryable: false },
    );
  }
  return {
    storage_version: 1,
    captured_at: capturedAt,
    observed_at: snapshotDocument.fetched_at,
    portfolio: {
      cash: snapshot.portfolio?.cash ?? null,
      total_pnl: snapshot.portfolio?.total_pnl ?? null,
      value: snapshot.portfolio?.value ?? null,
    },
    holdings: (snapshot.holdings || []).map((holding) => ({
      asset_class: holding.asset_class ?? null,
      quantity: holding.quantity,
      symbol: normalizeAgentSymbol(holding.symbol),
    })),
    transaction_fingerprints: (snapshot.transactions || []).map(
      transactionFingerprint,
    ),
    watchlist_symbols: (snapshot.agent_watchlist || []).map(
      (item) => item.symbol,
    ),
  };
}

export function diffMonitorStates(previous, current, snapshotDocument) {
  const snapshot = snapshotDocument.snapshot;
  const events = [];
  const occurrenceKey = current.observed_at || current.captured_at;
  const addEvent = (type, payload) => {
    events.push(event(type, payload, occurrenceKey));
  };
  const previousHoldings = keyedHoldings(previous.holdings);
  const currentHoldings = keyedHoldings(current.holdings);

  for (const [key, holding] of currentHoldings) {
    const before = previousHoldings.get(key);
    if (!before) {
      addEvent("position_opened", { holding });
      continue;
    }
    if (Math.abs(Number(holding.quantity) - Number(before.quantity)) > QUANTITY_EPSILON) {
      addEvent("position_quantity_changed", {
        after_quantity: holding.quantity,
        before_quantity: before.quantity,
        symbol: holding.symbol,
      });
    }
  }
  for (const [key, holding] of previousHoldings) {
    if (!currentHoldings.has(key)) {
      addEvent("position_closed", { holding });
    }
  }

  const previousTransactions = occurrenceCounts(
    previous.transaction_fingerprints,
  );
  const currentTransactions = new Map();
  for (const transaction of snapshot.transactions || []) {
    const fingerprint = transactionFingerprint(transaction);
    const occurrence = (currentTransactions.get(fingerprint) || 0) + 1;
    currentTransactions.set(fingerprint, occurrence);
    if (occurrence <= (previousTransactions.get(fingerprint) || 0)) {
      continue;
    }
    addEvent("transaction_added", {
      fingerprint,
      occurrence,
      transaction,
    });
  }

  const previousWatchlist = new Set(
    previous.watchlist_symbols.map(localSymbolKey),
  );
  const currentWatchlist = new Set(
    current.watchlist_symbols.map(localSymbolKey),
  );
  for (const symbol of current.watchlist_symbols) {
    if (!previousWatchlist.has(localSymbolKey(symbol))) {
      addEvent("watchlist_added", { symbol });
    }
  }
  for (const symbol of previous.watchlist_symbols) {
    if (!currentWatchlist.has(localSymbolKey(symbol))) {
      addEvent("watchlist_removed", { symbol });
    }
  }

  return {
    changed: events.length > 0,
    events,
    portfolio_delta: {
      cash: numericDelta(current.portfolio.cash, previous.portfolio.cash),
      total_pnl: numericDelta(
        current.portfolio.total_pnl,
        previous.portfolio.total_pnl,
      ),
      value: numericDelta(current.portfolio.value, previous.portfolio.value),
    },
  };
}

export function transactionFingerprint(transaction) {
  const fields = [
    transaction?.date ?? null,
    transaction?.type ?? null,
    transaction?.symbol ?? null,
    transaction?.side ?? null,
    transaction?.quantity ?? null,
    transaction?.price ?? null,
    transaction?.amount ?? null,
    transaction?.status ?? null,
  ];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

function keyedHoldings(holdings) {
  return new Map(
    holdings.map((holding) => [holdingKey(holding), holding]),
  );
}

function occurrenceCounts(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function symbolsMatch(holding, watchlistSymbol) {
  const holdingAliases = holdingSymbolAliases(holding);
  return watchlistSymbolAliases(watchlistSymbol).some((alias) =>
    holdingAliases.has(alias),
  );
}

function holdingSymbolAliases(holding) {
  const symbol = localSymbolKey(holding?.symbol);
  const aliases = new Set([symbol]);
  const slashQuoted = canonicalSlashUsdPair(symbol);
  if (slashQuoted) {
    aliases.add(slashQuoted);
    aliases.add(slashQuoted.slice(0, -3));
  }
  if (holding?.asset_class === "crypto") {
    const canonical = canonicalCryptoUsdPair(symbol);
    if (canonical) {
      aliases.add(canonical);
      aliases.add(canonical.slice(0, -3));
    }
  }
  return aliases;
}

function watchlistSymbolAliases(value) {
  const symbol = localSymbolKey(value);
  const aliases = [symbol];
  const slashQuoted = canonicalSlashUsdPair(symbol);
  if (slashQuoted) {
    aliases.push(slashQuoted);
  }
  return aliases;
}

function holdingKey(holding) {
  const symbol = localSymbolKey(holding?.symbol);
  if (holding?.asset_class === "crypto") {
    return canonicalCryptoUsdPair(symbol) || symbol;
  }
  return canonicalSlashUsdPair(symbol) || symbol;
}

function localSymbolKey(value) {
  return String(value || "").trim().toUpperCase();
}

function canonicalSlashUsdPair(symbol) {
  const match = symbol.match(/^(.+)\/USD$/);
  return match ? `${match[1]}USD` : null;
}

function canonicalCryptoUsdPair(symbol) {
  const match = symbol.match(/^(.+?)[./_-]?USD$/);
  return match && match[1] ? `${match[1]}USD` : null;
}

function validAgentTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function numericDelta(current, previous) {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined
  ) {
    return null;
  }
  return current - previous;
}

function event(type, payload, occurrenceKey) {
  return {
    event_id: createHash("sha256")
      .update(`${occurrenceKey}:${type}:${JSON.stringify(payload)}`)
      .digest("hex")
      .slice(0, 24),
    type,
    ...payload,
  };
}
