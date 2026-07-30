export const SARWA_WEB_URL = "https://www.sarwa.co/trade";
export const SARWA_API_ORIGIN = "https://apiv2.sarwa.co";
export const VERSION = "1.1.0";
export const OUTPUT_SCHEMA_VERSION = "1.0";

export const READ_ENDPOINTS = Object.freeze({
  accounts: {
    description: "List investment and trading accounts",
    path: "/api/account/list",
  },
  portfolio: {
    description: "Get the latest aggregate portfolio",
    path: "/api/aggregate-account/",
  },
  accountDetails: {
    accountPath: "/api/v1/account-trading-details/{account_id}",
    description: "Get Trade account value and performance",
  },
  positions: {
    accountPath: "/api/v1/positions/{account_id}",
    description: "List positions",
  },
  orders: {
    accountPath: "/api/v2/orders/{account_id}",
    description: "List orders for an account",
  },
  transactions: {
    accountPath: "/api/v1/transactions/{account_id}",
    description: "List transactions for an account",
  },
  marketClock: {
    description: "Get US market status",
    path: "/api/v1/market-clock",
  },
  watchlist: {
    description: "Get a curated market watchlist",
    path: "/api/v1/watchlist",
  },
});

export const AUTH_HEADER_PATTERN = /^(JWT|Bearer)\s+\S+$/i;
export const MAX_RESPONSE_BODY_BYTES = 10 * 1024 * 1024;
