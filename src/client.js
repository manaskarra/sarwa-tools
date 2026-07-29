import {
  buildDeepDive,
  buildHoldings,
  buildOverview,
  buildPortfolioView,
  buildTransactions,
  buildWatchlist,
  compactHolding,
  normalizeSymbol,
} from "./analytics.js";
import {
  listTradeAccounts,
  resolveTradeAccountExternalId,
} from "./accounts.js";
import { SarwaBrowserSession } from "./browser.js";
import { resolveEndpoint } from "./endpoints.js";
import { SarwaError } from "./errors.js";
import {
  decodeCursor,
  extractSourceTimestamp,
  fetchAllPages,
  fetchPage,
} from "./pagination.js";
import { successDocument } from "./output.js";

export class SarwaClient {
  constructor({ session } = {}) {
    this.session = session || null;
  }

  static async connect(options = {}) {
    const session = await new SarwaBrowserSession(options).open();
    try {
      await session.waitForAuthentication(options.authTimeoutMs);
      return new SarwaClient({ session });
    } catch (error) {
      await session.close();
      throw error;
    }
  }

  async accounts() {
    this.requireSession();
    return successDocument("accounts", await listTradeAccounts(this.session));
  }

  async portfolio({ account } = {}) {
    this.requireSession();
    const accountId = await this.resolveAccount(account);
    const [positions, orders, portfolioResponse] = await Promise.all([
      fetchAllPages(
        this.session,
        resolveEndpoint("positions", { account: accountId }),
        { pageSize: 200 },
      ),
      fetchAllPages(
        this.session,
        resolveEndpoint("orders", { account: accountId }),
        { pageSize: 200 },
      ),
      this.session.get(
        resolveEndpoint("accountDetails", { account: accountId }),
      ),
    ]);
    const holdings = buildHoldings(positions.response);
    const overview = buildOverview({
      ordersComplete: !orders.partial,
      ordersResponse: orders.response,
      portfolioResponse,
      positionsResponse: positions.response,
    });
    return successDocument(
      "portfolio",
      buildPortfolioView(overview, holdings),
      {
        partial: positions.partial || orders.partial || overview.partial,
        sourceAsOf: newestTimestamp(
          positions.sourceAsOf,
          orders.sourceAsOf,
          extractSourceTimestamp(portfolioResponse),
        ),
        warnings: unique([
          ...positions.warnings,
          ...orders.warnings,
          ...overview.warnings,
        ]),
      },
    );
  }

  async holdings({
    account,
    assetClass,
    historyLimit = 20,
    limit = 50,
    sort = "value",
    symbol,
  } = {}) {
    this.requireSession();
    const accountId = await this.resolveAccount(account);
    const positions = await fetchAllPages(
      this.session,
      resolveEndpoint("positions", { account: accountId }),
      { pageSize: 200 },
    );
    let holdings = buildHoldings(positions.response);

    if (symbol) {
      const normalized = normalizeSymbol(symbol);
      const [orders, transactions] = await Promise.all([
        fetchAllPages(
          this.session,
          resolveEndpoint("orders", { account: accountId }),
          { pageSize: 200 },
        ),
        fetchAllPages(
          this.session,
          resolveEndpoint("transactions", { account: accountId }),
          { pageSize: 200 },
        ),
      ]);
      const dive = buildDeepDive({
        ordersResponse: orders.response,
        positionsResponse: positions.response,
        symbol: normalized,
        transactionsResponse: transactions.response,
      });
      if (!dive.holding && dive.orders.length === 0 && dive.transactions.length === 0) {
        throw new SarwaError(
          "HOLDING_NOT_FOUND",
          `No current position or history was found for ${normalized}.`,
          { retryable: false },
        );
      }
      const value = {
        symbol: dive.symbol,
        holding: dive.holding ? compactHolding(dive.holding) : null,
        order_summary: snakeCaseOrderSummary(dive.orderSummary),
        orders: dive.orders.slice(0, historyLimit).map(compactOrder),
        transactions: dive.transactions.slice(0, historyLimit),
        note: dive.note,
      };
      return successDocument("holding", value, {
        partial: positions.partial || orders.partial || transactions.partial,
        sourceAsOf: newestTimestamp(
          positions.sourceAsOf,
          orders.sourceAsOf,
          transactions.sourceAsOf,
        ),
        warnings: unique([
          ...positions.warnings,
          ...orders.warnings,
          ...transactions.warnings,
        ]),
      });
    }

    if (assetClass) {
      const normalizedClass = assetClass.toLowerCase();
      holdings = holdings.filter(
        (holding) =>
          String(holding.assetClass || "").toLowerCase() === normalizedClass,
      );
    }
    holdings = sortHoldings(holdings, sort)
      .slice(0, limit)
      .map(compactHolding);
    return successDocument("holdings", holdings, {
      partial: positions.partial,
      sourceAsOf: positions.sourceAsOf,
      warnings: positions.warnings,
    });
  }

  async transactions({
    account,
    all = false,
    cursor,
    from,
    limit = 20,
    symbol,
    to,
  } = {}) {
    this.requireSession();
    const accountId = await this.resolveAccount(account);
    const endpoint = resolveEndpoint("transactions", { account: accountId });
    const mustReadHistory = all || Boolean(from) || Boolean(to);
    let pageResult;

    if (cursor && mustReadHistory) {
      throw new SarwaError(
        "USAGE",
        "--cursor cannot be combined with --all, --from, or --to.",
        { retryable: false },
      );
    }
    if (cursor) {
      pageResult = await fetchPage(
        this.session,
        decodeCursor(cursor, { expectedPathPrefix: endpoint }),
      );
    } else if (mustReadHistory) {
      pageResult = await fetchAllPages(this.session, endpoint, {
        pageSize: 200,
      });
    } else {
      pageResult = await fetchPage(
        this.session,
        withPageSize(endpoint, Math.max(limit, 20)),
      );
    }

    let transactions = buildTransactions(pageResult.response);
    if (symbol) {
      const normalized = normalizeSymbol(symbol);
      transactions = transactions.filter(
        (transaction) => normalizeSymbol(transaction.symbol) === normalized,
      );
    }
    if (from) {
      const fromTime = Date.parse(from);
      transactions = transactions.filter(
        (transaction) =>
          transaction.date && Date.parse(transaction.date) >= fromTime,
      );
    }
    if (to) {
      const toTime = endOfRange(to);
      transactions = transactions.filter(
        (transaction) =>
          transaction.date && Date.parse(transaction.date) <= toTime,
      );
    }
    if (!all) {
      transactions = transactions.slice(0, limit);
    }
    return successDocument("transactions", transactions, {
      has_more: Boolean(pageResult.nextCursor),
      next_cursor: pageResult.nextCursor || null,
      partial: Boolean(pageResult.partial),
      sourceAsOf: pageResult.sourceAsOf,
      warnings: pageResult.warnings || [],
    });
  }

  async watchlist({ limit = 20, name = "most-popular" } = {}) {
    this.requireSession();
    const path = withQuery(resolveEndpoint("watchlist"), {
      name,
      "page[number]": 1,
      "page[size]": limit,
    });
    const response = await this.session.get(path);
    return successDocument(
      "watchlist",
      {
        name,
        assets: buildWatchlist(response).slice(0, limit),
      },
      { sourceAsOf: extractSourceTimestamp(response) },
    );
  }

  async close() {
    if (this.session) {
      const session = this.session;
      this.session = null;
      await session.close();
    }
  }

  async resolveAccount(account) {
    return resolveTradeAccountExternalId(this.session, account);
  }

  requireSession() {
    if (!this.session) {
      throw new SarwaError(
        "CLIENT_CLOSED",
        "The Sarwa client is not connected.",
        { retryable: false },
      );
    }
  }
}

function sortHoldings(holdings, field) {
  const copy = [...holdings];
  if (field === "symbol") {
    return copy.sort((left, right) =>
      String(left.symbol).localeCompare(String(right.symbol)),
    );
  }
  const selector = {
    pnl: (holding) => holding.unrealizedPnl,
    return: (holding) => holding.unrealizedPnlRatio ?? Number.NEGATIVE_INFINITY,
    value: (holding) => holding.marketValue,
  }[field];
  if (!selector) {
    throw new SarwaError("USAGE", `Unsupported holdings sort: ${field}`, {
      retryable: false,
    });
  }
  return copy.sort((left, right) => selector(right) - selector(left));
}

function withPageSize(endpoint, pageSize) {
  return withQuery(endpoint, {
    "page[number]": 1,
    "page[size]": pageSize,
  });
}

function withQuery(endpoint, values) {
  const url = new URL(endpoint, "https://apiv2.sarwa.co");
  for (const [key, value] of Object.entries(values)) {
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function newestTimestamp(...values) {
  return values.filter(Boolean).sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

function unique(values) {
  return [...new Set(values)];
}

function endOfRange(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Date.parse(`${value}T23:59:59.999Z`);
  }
  return Date.parse(value);
}

function snakeCaseOrderSummary(summary) {
  return {
    explicit_commissions: summary.explicitCommissions,
    filled_buys: summary.filledBuys,
    filled_sells: summary.filledSells,
    gross_buy_spend: summary.grossBuySpend,
    gross_sell_proceeds: summary.grossSellProceeds,
    order_count: summary.orderCount,
  };
}

function compactOrder(order) {
  return {
    asset_class: order.assetClass,
    commission: order.commission,
    date: order.date,
    notional: order.notional,
    price: order.price,
    quantity: order.quantity,
    side: order.side,
    status: order.status,
    total_value: order.totalValue,
  };
}
