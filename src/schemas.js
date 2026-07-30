import { OUTPUT_SCHEMA_VERSION } from "./constants.js";
import { SarwaError } from "./errors.js";

const BASE_PROPERTIES = {
  schema_version: { const: OUTPUT_SCHEMA_VERSION },
  fetched_at: { type: "string", format: "date-time" },
  source_as_of: { type: ["string", "null"], format: "date-time" },
  partial: { type: "boolean" },
  warnings: { type: "array", items: { type: "string" } },
};

const AGENT_WATCHLIST_ITEM_SCHEMA = {
  type: "object",
  required: ["symbol", "note", "added_at", "updated_at"],
  properties: {
    symbol: { type: "string" },
    note: { type: ["string", "null"] },
    added_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
    is_held: { type: "boolean" },
    holding: { type: ["object", "null"] },
  },
};

const RESOURCE_SCHEMAS = Object.freeze({
  accounts: {
    type: "array",
    items: {
      type: "object",
      required: ["id", "name", "status"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        currency: { type: ["string", "null"] },
        status: { const: "open" },
      },
    },
  },
  portfolio: {
    type: "object",
    required: ["currency", "value", "total_pnl", "holdings"],
    properties: {
      currency: { type: "string" },
      value: { type: "number" },
      net_deposits: { type: ["number", "null"] },
      total_pnl: { type: "number" },
      total_return_pct: { type: ["number", "null"] },
      day_pnl: { type: ["number", "null"] },
      cash: { type: "number" },
      gross_buy_spend: { type: ["number", "null"] },
      holdings: { type: "object" },
    },
  },
  holdings: {
    type: "array",
    items: {
      type: "object",
      required: ["symbol", "quantity", "price", "value", "pnl"],
      properties: {
        symbol: { type: "string" },
        asset_class: { type: ["string", "null"] },
        quantity: { type: "number" },
        price: { type: "number" },
        value: { type: "number" },
        cost_basis: { type: "number" },
        pnl: { type: "number" },
        return_pct: { type: ["number", "null"] },
        day_pnl: { type: ["number", "null"] },
      },
    },
  },
  holding: {
    type: "object",
    required: ["symbol", "holding", "order_summary", "orders", "transactions"],
  },
  transactions: {
    type: "array",
    items: {
      type: "object",
      required: ["date", "type", "symbol", "amount"],
    },
  },
  watchlist: {
    type: "object",
    required: ["name", "assets"],
  },
  agent_watchlist: {
    type: "object",
    required: ["action", "changed", "items", "updated_at"],
    properties: {
      action: { enum: ["add", "list", "remove"] },
      changed: { type: "boolean" },
      item: AGENT_WATCHLIST_ITEM_SCHEMA,
      items: {
        type: "array",
        items: AGENT_WATCHLIST_ITEM_SCHEMA,
      },
      symbol: { type: "string" },
      updated_at: { type: ["string", "null"], format: "date-time" },
    },
  },
  snapshot: {
    type: "object",
    required: [
      "portfolio",
      "holdings",
      "transactions",
      "coverage",
      "agent_watchlist",
    ],
    properties: {
      portfolio: { type: "object" },
      holdings: { type: "array" },
      transactions: { type: "array" },
      coverage: {
        type: "object",
        required: ["transactions_complete", "transactions_has_more"],
      },
      agent_watchlist: {
        type: "array",
        items: AGENT_WATCHLIST_ITEM_SCHEMA,
      },
    },
  },
  monitor: {
    type: "object",
    required: [
      "baseline_at",
      "changed",
      "current",
      "events",
      "initialized",
      "observed_at",
      "portfolio_delta",
      "reset",
      "state_updated",
    ],
    properties: {
      baseline_at: { type: ["string", "null"], format: "date-time" },
      changed: { type: "boolean" },
      current: { type: "object" },
      events: { type: "array", items: { type: "object" } },
      initialized: { type: "boolean" },
      observed_at: { type: "string", format: "date-time" },
      portfolio_delta: { type: "object" },
      reset: { type: "boolean" },
      state_updated: { type: "boolean" },
    },
  },
  auth_status: {
    type: "object",
    required: ["authenticated", "profile_state"],
  },
});

export function schemaDocument(resource) {
  const resourceSchema = RESOURCE_SCHEMAS[resource];
  if (!resourceSchema) {
    throw new SarwaError(
      "USAGE",
      `No schema is available for resource: ${resource}`,
      { retryable: false },
    );
  }
  return {
    schema_version: OUTPUT_SCHEMA_VERSION,
    resource,
    type: "object",
    required: [
      "schema_version",
      "fetched_at",
      "source_as_of",
      "partial",
      "warnings",
      resource,
    ],
    properties: {
      ...BASE_PROPERTIES,
      [resource]: resourceSchema,
    },
  };
}
