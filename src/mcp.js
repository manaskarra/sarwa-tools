import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import {
  OUTPUT_SCHEMA_VERSION,
  VERSION,
} from "./constants.js";
import { normalizeError, SarwaError } from "./errors.js";
import { createSarwaMcpService } from "./mcp-service.js";
import { errorDocument } from "./output.js";
import { isDateInput } from "./validation.js";

const ACCOUNT_INPUT = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .describe("Sarwa Trade account ID; omit when exactly one account is open")
  .optional();
const SYMBOL_INPUT = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .describe("Trading symbol, for example NVDA or BTCUSD");
const DATE_INPUT = z
  .string()
  .max(64)
  .refine(isDateInput, "Use a valid YYYY-MM-DD date or ISO 8601 timestamp");
const READ_ONLY_EXTERNAL = Object.freeze({
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  readOnlyHint: true,
});
const READ_ONLY_LOCAL = Object.freeze({
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
});

export function createSarwaMcpServer({
  service = createSarwaMcpService(),
} = {}) {
  const server = new McpServer(
    {
      name: "sarwa-tools",
      version: VERSION,
    },
    {
      instructions:
        "Use these tools to read the authenticated user's Sarwa portfolio and manage the private local agent watchlist. Sarwa operations are read-only. Run `sarwa auth login` outside MCP if authentication is missing. Treat all returned portfolio data as sensitive financial information.",
    },
  );

  registerTool(
    server,
    "sarwa_auth_status",
    {
      title: "Sarwa authentication status",
      description:
        "Check whether the secure local Sarwa browser session is authenticated. This never returns credentials.",
      annotations: READ_ONLY_EXTERNAL,
      inputSchema: {},
      resource: "auth_status",
    },
    (_, context) => service.authStatus(context),
  );

  registerTool(
    server,
    "sarwa_accounts",
    {
      title: "List Sarwa Trade accounts",
      description: "List the authenticated user's open Sarwa Trade accounts.",
      annotations: READ_ONLY_EXTERNAL,
      inputSchema: {},
      resource: "accounts",
    },
    (_, context) => service.accounts(context),
  );

  registerTool(
    server,
    "sarwa_portfolio",
    {
      title: "Get Sarwa portfolio",
      description:
        "Get portfolio value, profit and loss, deposits, cash, spend, and top holdings.",
      inputSchema: { account: ACCOUNT_INPUT },
      annotations: READ_ONLY_EXTERNAL,
      resource: "portfolio",
    },
    ({ account }, context) =>
      service.portfolio({ account }, context),
  );

  registerTool(
    server,
    "sarwa_holdings",
    {
      title: "List Sarwa holdings",
      description:
        "List current holdings with quantities, prices, values, profit and loss, returns, and daily movement.",
      inputSchema: {
        account: ACCOUNT_INPUT,
        asset_class: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .describe("Optional asset class filter, for example us_equity or crypto")
          .optional(),
        limit: z.number().int().min(1).max(500).default(50),
        sort: z
          .enum(["value", "pnl", "return", "symbol"])
          .default("value"),
      },
      annotations: READ_ONLY_EXTERNAL,
      resource: "holdings",
    },
    ({ account, asset_class: assetClass, limit, sort }, context) =>
      service.holdings(
        { account, assetClass, limit, sort },
        context,
      ),
  );

  registerTool(
    server,
    "sarwa_holding",
    {
      title: "Inspect one Sarwa holding",
      description:
        "Inspect one symbol's current position, order summary, orders, and transactions.",
      inputSchema: {
        account: ACCOUNT_INPUT,
        history_limit: z.number().int().min(1).max(100).default(20),
        symbol: SYMBOL_INPUT,
      },
      annotations: READ_ONLY_EXTERNAL,
      resource: "holding",
    },
    ({ account, history_limit: historyLimit, symbol }, context) =>
      service.holdings(
        { account, historyLimit, symbol },
        context,
      ),
  );

  registerTool(
    server,
    "sarwa_transactions",
    {
      title: "List Sarwa transactions",
      description:
        "List portfolio activity with optional pagination, symbol, and date filters. Set all to true only when complete available history is needed.",
      inputSchema: {
        account: ACCOUNT_INPUT,
        all: z.boolean().default(false),
        cursor: z
          .string()
          .min(1)
          .max(8192)
          .describe("Opaque next_cursor from a previous response")
          .optional(),
        from: DATE_INPUT
          .describe("Inclusive start date or ISO timestamp")
          .optional(),
        limit: z.number().int().min(1).max(500).default(20),
        symbol: SYMBOL_INPUT.optional(),
        to: DATE_INPUT
          .describe("Inclusive end date or ISO timestamp")
          .optional(),
      },
      annotations: READ_ONLY_EXTERNAL,
      resource: "transactions",
    },
    (options, context) => service.transactions(options, context),
  );

  registerTool(
    server,
    "sarwa_market_watchlist",
    {
      title: "Get a Sarwa market list",
      description:
        "Read a Sarwa-curated market list. This is separate from the private local agent watchlist.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20),
        name: z.enum(["most-popular", "top-movers"]).default("most-popular"),
      },
      annotations: READ_ONLY_EXTERNAL,
      resource: "watchlist",
    },
    ({ limit, name }, context) =>
      service.marketWatchlist({ limit, name }, context),
  );

  registerTool(
    server,
    "sarwa_agent_watchlist",
    {
      title: "List the local agent watchlist",
      description:
        "List symbols and notes stored privately on this machine for portfolio agents.",
      annotations: READ_ONLY_LOCAL,
      inputSchema: {},
      resource: "agent_watchlist",
    },
    (_, context) => service.agentWatchlist(context),
  );

  registerTool(
    server,
    "sarwa_agent_watchlist_add",
    {
      title: "Add to the local agent watchlist",
      description:
        "Add or update a symbol in the private local agent watchlist. This does not change anything in Sarwa.",
      inputSchema: {
        note: z
          .string()
          .max(500)
          .describe("Optional context for an agent")
          .optional(),
        symbol: SYMBOL_INPUT,
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      resource: "agent_watchlist",
    },
    ({ note, symbol }, context) =>
      service.addAgentWatchlist(symbol, note, context),
  );

  registerTool(
    server,
    "sarwa_agent_watchlist_remove",
    {
      title: "Remove from the local agent watchlist",
      description:
        "Remove a symbol from the private local agent watchlist. This does not change anything in Sarwa.",
      inputSchema: { symbol: SYMBOL_INPUT },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      resource: "agent_watchlist",
    },
    ({ symbol }, context) =>
      service.removeAgentWatchlist(symbol, context),
  );

  registerTool(
    server,
    "sarwa_snapshot",
    {
      title: "Get an agent-ready Sarwa snapshot",
      description:
        "Get one coherent portfolio, holdings, transactions, coverage, and enriched local-watchlist document.",
      inputSchema: {
        account: ACCOUNT_INPUT,
        all_transactions: z.boolean().default(false),
        transaction_limit: z.number().int().min(1).max(100).default(100),
      },
      annotations: READ_ONLY_EXTERNAL,
      resource: "snapshot",
    },
    ({
      account,
      all_transactions: allTransactions,
      transaction_limit: transactionLimit,
    }, context) =>
      service.snapshot(
        { account, allTransactions, transactionLimit },
        context,
      ),
  );

  registerTool(
    server,
    "sarwa_monitor",
    {
      title: "Check for Sarwa portfolio changes",
      description:
        "Compare a complete current snapshot with the account-scoped private local baseline and return stable events. This advances the baseline after a complete observation.",
      inputSchema: {
        account: ACCOUNT_INPUT,
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      resource: "monitor",
    },
    ({ account }, context) =>
      service.monitor({ account, reset: false }, context),
  );

  registerTool(
    server,
    "sarwa_monitor_reset",
    {
      title: "Reset the Sarwa monitor baseline",
      description:
        "Replace the selected account's private local monitor baseline with a complete current snapshot without emitting historical events.",
      inputSchema: {
        account: ACCOUNT_INPUT,
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      resource: "monitor",
    },
    ({ account }, context) =>
      service.monitor({ account, reset: true }, context),
  );

  async function close() {
    try {
      await server.close();
    } finally {
      await service.close();
    }
  }

  server.server.onclose = () => {
    void service.close();
  };

  return { close, server, service };
}

export async function runMcpServer({
  service,
  transport = new StdioServerTransport(),
} = {}) {
  const instance = createSarwaMcpServer({ service });
  await instance.server.connect(transport);
  return instance;
}

function registerTool(server, name, config, handler) {
  const { resource, ...toolConfig } = config;
  server.registerTool(
    name,
    {
      ...toolConfig,
      outputSchema: outputDocumentSchema(resource),
    },
    async (input, extra) => {
      try {
        return toolResult(
          await handler(input || {}, { signal: extra.signal }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

function outputDocumentSchema(resource) {
  return z.looseObject({
    schema_version: z.literal(OUTPUT_SCHEMA_VERSION),
    fetched_at: z.string(),
    source_as_of: z.string().nullable(),
    partial: z.boolean(),
    warnings: z.array(z.string()),
    [resource]: z.unknown(),
  });
}

function toolResult(document) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(document, null, 2),
      },
    ],
    structuredContent: document,
  };
}

function toolError(error) {
  let normalized = normalizeError(error);
  if (normalized.code === "INTERNAL_ERROR") {
    normalized = new SarwaError(
      "INTERNAL_ERROR",
      "The Sarwa MCP server encountered an unexpected internal failure.",
      { retryable: false },
    );
  }
  const document = errorDocument(normalized);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(document, null, 2),
      },
    ],
    isError: true,
    structuredContent: document,
  };
}
