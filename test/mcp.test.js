import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { SarwaError } from "../src/errors.js";
import { createSarwaMcpServer } from "../src/mcp.js";

const bin = fileURLToPath(new URL("../bin/sarwa-mcp.js", import.meta.url));
const TOOL_NAMES = [
  "sarwa_auth_status",
  "sarwa_accounts",
  "sarwa_portfolio",
  "sarwa_holdings",
  "sarwa_holding",
  "sarwa_transactions",
  "sarwa_market_watchlist",
  "sarwa_agent_watchlist",
  "sarwa_agent_watchlist_add",
  "sarwa_agent_watchlist_remove",
  "sarwa_snapshot",
  "sarwa_monitor",
  "sarwa_monitor_reset",
];

test("MCP protocol lists stable tools and calls them with validated input", async () => {
  const calls = [];
  const service = fakeService({
    addAgentWatchlist: async (symbol, note) => {
      calls.push(["addAgentWatchlist", symbol, note]);
      return document("agent_watchlist", {
        action: "add",
        changed: true,
        items: [{ note, symbol }],
      });
    },
    holdings: async (options) => {
      calls.push(["holdings", options]);
      return document("holdings", []);
    },
    portfolio: async (options) => {
      calls.push(["portfolio", options]);
      return document("portfolio", { value: 100 });
    },
  });
  const connection = await connectInMemory(service);
  try {
    const listed = await connection.client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      TOOL_NAMES,
    );
    const portfolioTool = listed.tools.find(
      (tool) => tool.name === "sarwa_portfolio",
    );
    assert.equal(portfolioTool.annotations.readOnlyHint, true);
    assert.equal(portfolioTool.annotations.openWorldHint, true);
    assert.equal(portfolioTool.outputSchema.properties.portfolio !== undefined, true);
    const authTool = listed.tools.find(
      (tool) => tool.name === "sarwa_auth_status",
    );
    assert.equal(authTool.annotations.openWorldHint, true);
    const resetTool = listed.tools.find(
      (tool) => tool.name === "sarwa_monitor_reset",
    );
    assert.equal(resetTool.annotations.destructiveHint, true);

    const portfolio = await connection.client.callTool({
      name: "sarwa_portfolio",
      arguments: { account: "account-1" },
    });
    assert.equal(portfolio.isError, undefined);
    assert.equal(portfolio.structuredContent.portfolio.value, 100);

    await connection.client.callTool({
      name: "sarwa_holdings",
      arguments: {},
    });
    await connection.client.callTool({
      name: "sarwa_agent_watchlist_add",
      arguments: { note: "Watch earnings", symbol: "nvda" },
    });

    assert.deepEqual(calls, [
      ["portfolio", { account: "account-1" }],
      [
        "holdings",
        {
          account: undefined,
          assetClass: undefined,
          limit: 50,
          sort: "value",
        },
      ],
      ["addAgentWatchlist", "nvda", "Watch earnings"],
    ]);
  } finally {
    await connection.close();
  }
});

test("MCP protocol rejects invalid input before invoking a service", async () => {
  let calls = 0;
  const connection = await connectInMemory(
    fakeService({
      holdings: async () => {
        calls += 1;
        return document("holdings", []);
      },
    }),
  );
  try {
    const result = await connection.client.callTool({
      name: "sarwa_holdings",
      arguments: { limit: 0 },
    });

    assert.equal(result.isError, true);
    assert.equal(calls, 0);
    assert.match(result.content[0].text, /Input validation error/);

    const invalidDate = await connection.client.callTool({
      name: "sarwa_transactions",
      arguments: { from: "2026-02-30" },
    });
    assert.equal(invalidDate.isError, true);
    assert.match(invalidDate.content[0].text, /valid YYYY-MM-DD/);
  } finally {
    await connection.close();
  }
});

test("every MCP tool maps to the intended service operation", async () => {
  const calls = [];
  const service = fakeService({
    accounts: async () => record(calls, "accounts", document("accounts", [])),
    addAgentWatchlist: async () =>
      record(
        calls,
        "addAgentWatchlist",
        document("agent_watchlist", {}),
      ),
    agentWatchlist: async () =>
      record(calls, "agentWatchlist", document("agent_watchlist", {})),
    authStatus: async () =>
      record(calls, "authStatus", document("auth_status", {})),
    holdings: async (options) =>
      record(
        calls,
        options.symbol ? "holding" : "holdings",
        document(options.symbol ? "holding" : "holdings", options.symbol ? {} : []),
      ),
    marketWatchlist: async () =>
      record(calls, "marketWatchlist", document("watchlist", {})),
    monitor: async ({ reset }) =>
      record(
        calls,
        reset ? "monitorReset" : "monitor",
        document("monitor", {}),
      ),
    portfolio: async () =>
      record(calls, "portfolio", document("portfolio", {})),
    removeAgentWatchlist: async () =>
      record(
        calls,
        "removeAgentWatchlist",
        document("agent_watchlist", {}),
      ),
    snapshot: async () =>
      record(calls, "snapshot", document("snapshot", {})),
    transactions: async () =>
      record(calls, "transactions", document("transactions", [])),
  });
  const connection = await connectInMemory(service);
  const invocations = [
    ["sarwa_auth_status", {}],
    ["sarwa_accounts", {}],
    ["sarwa_portfolio", {}],
    ["sarwa_holdings", {}],
    ["sarwa_holding", { symbol: "NVDA" }],
    ["sarwa_transactions", {}],
    ["sarwa_market_watchlist", {}],
    ["sarwa_agent_watchlist", {}],
    ["sarwa_agent_watchlist_add", { symbol: "NVDA" }],
    ["sarwa_agent_watchlist_remove", { symbol: "NVDA" }],
    ["sarwa_snapshot", {}],
    ["sarwa_monitor", {}],
    ["sarwa_monitor_reset", {}],
  ];
  try {
    for (const [name, args] of invocations) {
      const result = await connection.client.callTool({
        name,
        arguments: args,
      });
      assert.equal(result.isError, undefined, name);
    }
    assert.deepEqual(calls, [
      "authStatus",
      "accounts",
      "portfolio",
      "holdings",
      "holding",
      "transactions",
      "marketWatchlist",
      "agentWatchlist",
      "addAgentWatchlist",
      "removeAgentWatchlist",
      "snapshot",
      "monitor",
      "monitorReset",
    ]);
  } finally {
    await connection.close();
  }
});

test("MCP protocol returns structured safe application errors", async () => {
  const connection = await connectInMemory(
    fakeService({
      accounts: async () => {
        throw new SarwaError(
          "AUTH_REQUIRED",
          "Run `sarwa auth login`.",
          { retryable: false },
        );
      },
      portfolio: async () => {
        throw new Error("/private/secret/profile failed");
      },
    }),
  );
  try {
    const authError = await connection.client.callTool({
      name: "sarwa_accounts",
      arguments: {},
    });
    assert.equal(authError.isError, true);
    assert.deepEqual(authError.structuredContent.error, {
      code: "AUTH_REQUIRED",
      message: "Run `sarwa auth login`.",
      retryable: false,
    });

    const internalError = await connection.client.callTool({
      name: "sarwa_portfolio",
      arguments: {},
    });
    assert.equal(internalError.isError, true);
    assert.equal(
      internalError.structuredContent.error.message,
      "The Sarwa MCP server encountered an unexpected internal failure.",
    );
    assert.doesNotMatch(internalError.content[0].text, /private|secret|profile/);
  } finally {
    await connection.close();
  }
});

test("sarwa-mcp executable completes a real stdio handshake", async () => {
  const transport = new StdioClientTransport({
    args: [bin],
    command: process.execPath,
    stderr: "pipe",
  });
  const client = new Client({
    name: "sarwa-cli-stdio-test",
    version: "1.0.0",
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      TOOL_NAMES,
    );
  } finally {
    await client.close();
  }
});

async function connectInMemory(service) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const instance = createSarwaMcpServer({ service });
  const client = new Client({
    name: "sarwa-cli-test",
    version: "1.0.0",
  });
  await instance.server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await instance.close();
    },
  };
}

function fakeService(overrides = {}) {
  return {
    accounts: async () => document("accounts", []),
    addAgentWatchlist: async () => document("agent_watchlist", {}),
    agentWatchlist: async () => document("agent_watchlist", {}),
    authStatus: async () =>
      document("auth_status", {
        authenticated: true,
        profile_state: "secure",
      }),
    close: async () => {},
    holdings: async ({ symbol } = {}) =>
      symbol ? document("holding", {}) : document("holdings", []),
    marketWatchlist: async () => document("watchlist", {}),
    monitor: async () => document("monitor", {}),
    portfolio: async () => document("portfolio", {}),
    removeAgentWatchlist: async () => document("agent_watchlist", {}),
    snapshot: async () => document("snapshot", {}),
    transactions: async () => document("transactions", []),
    ...overrides,
  };
}

function document(resource, value) {
  return {
    schema_version: "1.0",
    fetched_at: "2026-07-30T00:00:00.000Z",
    source_as_of: null,
    partial: false,
    warnings: [],
    [resource]: value,
  };
}

function record(calls, name, result) {
  calls.push(name);
  return result;
}
