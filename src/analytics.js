import { schemaError } from "./errors.js";

export function responseItems(response, field = "data") {
  if (Array.isArray(response)) {
    return response;
  }
  if (response && typeof response === "object" && Array.isArray(response.data)) {
    return response.data;
  }
  throw schemaError(field, "must be an array");
}

export function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\/USD$/, "");
}

export function buildHoldings(positionsResponse) {
  return responseItems(positionsResponse, "positions.data").map(
    (item, index) => {
      const position = attributes(item, `positions.data[${index}]`);
      return {
        assetClass: optionalString(position.asset_class),
        averageEntryPrice: optionalNumber(
          position.avg_entry_price,
          `positions.data[${index}].avg_entry_price`,
        ),
        costBasis: requiredNumber(
          position.cost_basis,
          `positions.data[${index}].cost_basis`,
        ),
        currentPrice: requiredNumber(
          position.current_price,
          `positions.data[${index}].current_price`,
        ),
        dailyPnl: optionalNumber(
          position.unrealized_intraday_pl,
          `positions.data[${index}].unrealized_intraday_pl`,
        ),
        dailyPnlRatio: optionalNumber(
          position.unrealized_intraday_plpc,
          `positions.data[${index}].unrealized_intraday_plpc`,
        ),
        marketValue: requiredNumber(
          position.market_value,
          `positions.data[${index}].market_value`,
        ),
        name: optionalString(position.name),
        portfolioWeight: optionalNumber(
          position.percent_of_equity,
          `positions.data[${index}].percent_of_equity`,
        ),
        quantity: requiredNumber(
          position.qty,
          `positions.data[${index}].qty`,
        ),
        symbol: requiredString(
          position.symbol ?? position.friendly_symbol,
          `positions.data[${index}].symbol`,
        ),
        unrealizedPnl: requiredNumber(
          position.unrealized_pl,
          `positions.data[${index}].unrealized_pl`,
        ),
        unrealizedPnlRatio: optionalNumber(
          position.unrealized_plpc,
          `positions.data[${index}].unrealized_plpc`,
        ),
      };
    },
  );
}

export function buildOverview({
  ordersComplete = true,
  ordersResponse,
  portfolioResponse,
  positionsResponse,
}) {
  const portfolio = attributes(
    portfolioResponse?.data ?? portfolioResponse,
    "portfolio",
  );
  const holdings = buildHoldings(positionsResponse);
  const orders = responseItems(ordersResponse, "orders.data")
    .map((item, index) => attributes(item, `orders.data[${index}]`))
    .filter((order) => String(order.status || "").toLowerCase() === "filled");
  const buyOrders = orders.filter(
    (order) => String(order.side || "").toLowerCase() === "buy",
  );
  const sellOrders = orders.filter(
    (order) => String(order.side || "").toLowerCase() === "sell",
  );

  const holdingsMarketValue = sum(holdings, (holding) => holding.marketValue);
  const holdingsCostBasis = sum(holdings, (holding) => holding.costBasis);
  const unrealizedPnl = sum(holdings, (holding) => holding.unrealizedPnl);
  const positionDailyPnl = sumOptional(
    holdings,
    (holding) => holding.dailyPnl,
  );
  const accountValue = requiredNumber(
    portfolio.equity ?? portfolio.value ?? portfolio.balance,
    "portfolio.value",
  );
  const hasReportedCash =
    portfolio.cash !== null && portfolio.cash !== undefined;
  const cash = hasReportedCash
    ? requiredNumber(portfolio.cash, "portfolio.cash")
    : nearZero(accountValue - holdingsMarketValue);
  const returns =
    portfolio.returns && typeof portfolio.returns === "object"
      ? portfolio.returns
      : {};
  const warnings = [];
  if (!ordersComplete) {
    warnings.push(
      "Order history is incomplete; gross buy spend and sell proceeds are unavailable.",
    );
  }

  const assetClasses = [...new Set(holdings.map((holding) => holding.assetClass))]
    .filter(Boolean)
    .map((assetClass) => {
      const matching = holdings.filter(
        (holding) => holding.assetClass === assetClass,
      );
      const marketValue = sum(matching, (holding) => holding.marketValue);
      return {
        assetClass,
        count: matching.length,
        marketValue,
        weightRatio: accountValue ? marketValue / accountValue : null,
      };
    })
    .sort((left, right) => right.marketValue - left.marketValue);

  return {
    currency:
      optionalString(
        portfolio.currency ||
          portfolio.value_currency ||
          portfolio.balance_currency,
      ) || "USD",
    partial: !ordersComplete,
    warnings,
    reported: {
      accountValue,
      cash,
      dailyPnl:
        optionalNumber(
          portfolio.intraday_p_and_l_amount,
          "portfolio.intraday_p_and_l_amount",
        ) ?? positionDailyPnl,
      netDeposits: optionalNumber(
        portfolio.net_deposits,
        "portfolio.net_deposits",
      ),
      totalPnl: requiredNumber(portfolio.earnings, "portfolio.earnings"),
      moneyWeightedReturnRatio: optionalNumber(
        returns.money_weighted,
        "portfolio.returns.money_weighted",
      ),
      simpleReturnRatio: optionalNumber(
        returns.simple ??
          (typeof portfolio.returns === "number" ||
          typeof portfolio.returns === "string"
            ? portfolio.returns
            : null),
        "portfolio.returns.simple",
      ),
      timeWeightedReturnRatio: optionalNumber(
        returns.time_weighted,
        "portfolio.returns.time_weighted",
      ),
    },
    calculated: {
      assetClasses,
      explicitCommissions: sumOptional(
        orders,
        (order, index) =>
          optionalNumber(order.commission, `orders.data[${index}].commission`),
      ),
      filledBuyOrders: buyOrders.length,
      filledSellOrders: sellOrders.length,
      grossBuySpend: ordersComplete
        ? sum(buyOrders, (order, index) =>
            orderCashValue(order, `orders.data[${index}]`),
          )
        : null,
      grossSellProceeds: ordersComplete
        ? sum(sellOrders, (order, index) =>
            orderCashValue(order, `orders.data[${index}]`),
          )
        : null,
      holdingCount: holdings.length,
      holdingsCostBasis,
      holdingsMarketValue,
      unrealizedPnl,
      unrealizedPnlRatio: holdingsCostBasis
        ? unrealizedPnl / holdingsCostBasis
        : null,
    },
  };
}

export function buildDeepDive({
  ordersResponse,
  positionsResponse,
  symbol,
  transactionsResponse,
}) {
  const normalized = normalizeSymbol(symbol);
  const holding =
    buildHoldings(positionsResponse).find(
      (candidate) => normalizeSymbol(candidate.symbol) === normalized,
    ) || null;
  const orders = responseItems(ordersResponse, "orders.data")
    .map((item, index) => attributes(item, `orders.data[${index}]`))
    .filter((order) => normalizeSymbol(order.symbol) === normalized)
    .map((order, index) => ({
      assetClass: optionalString(order.asset_class),
      commission: optionalNumber(
        order.commission,
        `matchingOrders[${index}].commission`,
      ),
      date: normalizeDate(
        order.filled_at ?? order.submitted_at ?? order.created_at,
        `matchingOrders[${index}].date`,
      ),
      notional: optionalNumber(
        order.notional,
        `matchingOrders[${index}].notional`,
      ),
      price: optionalNumber(
        order.filled_avg_price ?? order.price_per_share,
        `matchingOrders[${index}].price`,
      ),
      quantity: optionalNumber(
        order.filled_qty ?? order.number_of_shares ?? order.qty,
        `matchingOrders[${index}].quantity`,
      ),
      side: optionalString(order.side),
      status: optionalString(order.status),
      totalValue: optionalNumber(
        order.total_value ?? order.amount,
        `matchingOrders[${index}].total_value`,
      ),
    }))
    .sort(descendingDate);
  const transactions = buildTransactions(transactionsResponse).filter(
    (transaction) => normalizeSymbol(transaction.symbol) === normalized,
  );
  const filledOrders = orders.filter(
    (order) => String(order.status || "").toLowerCase() === "filled",
  );
  const filledBuys = filledOrders.filter(
    (order) => String(order.side || "").toLowerCase() === "buy",
  );
  const filledSells = filledOrders.filter(
    (order) => String(order.side || "").toLowerCase() === "sell",
  );

  return {
    symbol: normalized,
    holding,
    orderSummary: {
      explicitCommissions: sumOptional(
        filledOrders,
        (order) => order.commission,
      ),
      filledBuys: filledBuys.length,
      filledSells: filledSells.length,
      grossBuySpend: sum(filledBuys, (order, index) =>
        orderCashValue(order, `matchingOrders[${index}]`),
      ),
      grossSellProceeds: sum(filledSells, (order, index) =>
        orderCashValue(order, `matchingOrders[${index}]`),
      ),
      orderCount: orders.length,
    },
    orders,
    transactionCount: transactions.length,
    transactions,
    note:
      "Current unrealized P&L and trading history only; no tax lots or inferred realized P&L.",
  };
}

export function buildPortfolioView(overview, holdings, topLimit = 5) {
  const reported = overview.reported;
  const calculated = overview.calculated;
  return {
    currency: overview.currency,
    value: reported.accountValue,
    net_deposits: reported.netDeposits,
    total_pnl: reported.totalPnl,
    total_return_pct:
      reported.simpleReturnRatio === null
        ? null
        : reported.simpleReturnRatio * 100,
    day_pnl: reported.dailyPnl,
    cash: reported.cash,
    gross_buy_spend: calculated.grossBuySpend,
    holdings: {
      count: calculated.holdingCount,
      value: calculated.holdingsMarketValue,
      cost_basis: calculated.holdingsCostBasis,
      unrealized_pnl: calculated.unrealizedPnl,
      unrealized_return_pct:
        calculated.unrealizedPnlRatio === null
          ? null
          : calculated.unrealizedPnlRatio * 100,
      top: [...holdings]
        .sort((left, right) => right.marketValue - left.marketValue)
        .slice(0, topLimit)
        .map(compactHolding),
    },
  };
}

export function buildTransactions(transactionsResponse) {
  return responseItems(transactionsResponse, "transactions.data")
    .map((item, index) => {
      const transaction = attributes(item, `transactions.data[${index}]`);
      return {
        amount: optionalNumber(
          transaction.net_amount ??
            transaction.total_value ??
            transaction.amount,
          `transactions.data[${index}].amount`,
        ),
        asset_class: optionalString(transaction.asset_class),
        date: normalizeDate(
          transaction.created_at ?? transaction.date,
          `transactions.data[${index}].date`,
        ),
        price: optionalNumber(
          transaction.price_per_share ?? transaction.price,
          `transactions.data[${index}].price`,
        ),
        quantity: optionalNumber(
          transaction.number_of_shares ?? transaction.qty,
          `transactions.data[${index}].quantity`,
        ),
        side: optionalString(transaction.side ?? transaction.flow),
        status: optionalString(transaction.status),
        symbol: optionalString(
          transaction.symbol ?? transaction.friendly_symbol,
        ),
        type: optionalString(transaction.activity_type),
      };
    })
    .sort(descendingDate);
}

export function buildWatchlist(watchlistResponse) {
  return responseItems(watchlistResponse, "watchlist.data").map(
    (item, index) => {
      const asset = attributes(item, `watchlist.data[${index}]`);
      return {
        asset_class: optionalString(asset.type),
        change_pct: optionalNumber(
          asset.percentChange,
          `watchlist.data[${index}].percentChange`,
        ),
        name: optionalString(asset.name),
        price: requiredNumber(
          asset.price,
          `watchlist.data[${index}].price`,
        ),
        symbol: requiredString(
          asset.symbol,
          `watchlist.data[${index}].symbol`,
        ),
      };
    },
  );
}

export function compactHolding(holding) {
  return {
    asset_class: holding.assetClass,
    cost_basis: holding.costBasis,
    day_pnl: holding.dailyPnl,
    pnl: holding.unrealizedPnl,
    price: holding.currentPrice,
    quantity: holding.quantity,
    return_pct:
      holding.unrealizedPnlRatio === null
        ? null
        : holding.unrealizedPnlRatio * 100,
    symbol: holding.symbol,
    value: holding.marketValue,
  };
}

export function normalizeDate(value, field = "date") {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  let milliseconds = value;
  if (typeof value === "number") {
    milliseconds = value < 1e12 ? value * 1_000 : value;
  } else if (/^\d{10,13}$/.test(String(value))) {
    const numeric = Number(value);
    milliseconds = numeric < 1e12 ? numeric * 1_000 : numeric;
  }
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    throw schemaError(field, "must be a valid date");
  }
  return date.toISOString();
}

function attributes(item, field) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw schemaError(field, "must be an object");
  }
  if (item.attributes !== undefined) {
    if (
      !item.attributes ||
      typeof item.attributes !== "object" ||
      Array.isArray(item.attributes)
    ) {
      throw schemaError(`${field}.attributes`, "must be an object");
    }
    return item.attributes;
  }
  return item;
}

function requiredNumber(value, field) {
  const number = optionalNumber(value, field);
  if (number === null) {
    throw schemaError(field, "is required");
  }
  return number;
}

function optionalNumber(value, field) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const scalar =
    value && typeof value === "object" && !Array.isArray(value)
      ? value.value
      : value;
  const parsed = Number(scalar);
  if (!Number.isFinite(parsed)) {
    throw schemaError(field, "must be a finite number");
  }
  return parsed;
}

function requiredString(value, field) {
  const string = optionalString(value);
  if (!string) {
    throw schemaError(field, "is required");
  }
  return string;
}

function optionalString(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return String(value);
  }
  return value;
}

function orderCashValue(order, field) {
  const notional = optionalNumber(order.notional, `${field}.notional`);
  const totalValue = optionalNumber(
    order.totalValue ?? order.total_value ?? order.amount,
    `${field}.total_value`,
  );
  if (notional === null && totalValue === null) {
    throw schemaError(
      `${field}.total_value`,
      "is required for a filled order",
    );
  }
  return Math.max(notional ?? Number.NEGATIVE_INFINITY, totalValue ?? Number.NEGATIVE_INFINITY);
}

function sum(items, selector) {
  return items.reduce((total, item, index) => total + selector(item, index), 0);
}

function sumOptional(items, selector) {
  return items.reduce(
    (total, item, index) => total + (selector(item, index) ?? 0),
    0,
  );
}

function nearZero(value) {
  return Math.abs(value) < 0.005 ? 0 : value;
}

function descendingDate(left, right) {
  return Date.parse(right.date || 0) - Date.parse(left.date || 0);
}
