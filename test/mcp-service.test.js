import assert from "node:assert/strict";
import test from "node:test";

import { SarwaError } from "../src/errors.js";
import { createSarwaMcpService } from "../src/mcp-service.js";

test("MCP service scopes each authenticated client to one tool call", async () => {
  const calls = [];
  let authChecks = 0;
  let closes = 0;
  let connections = 0;
  const service = createSarwaMcpService({
    checkAuthentication: async () => {
      authChecks += 1;
      return { authenticated: true, profile_state: "secure" };
    },
    connectClient: async () => {
      connections += 1;
      return {
        accounts: async () => {
          calls.push(["accounts"]);
          return { accounts: [] };
        },
        close: async () => {
          closes += 1;
        },
        portfolio: async (options) => {
          calls.push(["portfolio", options]);
          return { portfolio: { value: 100 } };
        },
      };
    },
  });

  await service.accounts();
  await service.portfolio({ account: "account-1" });
  const status = await service.authStatus();
  await service.close();

  assert.equal(connections, 2);
  assert.equal(authChecks, 1);
  assert.equal(closes, 2);
  assert.deepEqual(calls, [
    ["accounts"],
    ["portfolio", { account: "account-1" }],
  ]);
  assert.deepEqual(status.auth_status, {
    authenticated: true,
    profile_state: "secure",
  });
});

test("MCP service closes an expired client before the next call", async () => {
  let connections = 0;
  let expiredCloses = 0;
  const service = createSarwaMcpService({
    connectClient: async () => {
      connections += 1;
      if (connections === 1) {
        return {
          accounts: async () => {
            throw new SarwaError(
              "AUTH_REQUIRED",
              "Run `sarwa auth login`.",
              { retryable: false },
            );
          },
          close: async () => {
            expiredCloses += 1;
          },
        };
      }
      return {
        accounts: async () => ({ accounts: [{ id: "account-1" }] }),
        close: async () => {},
      };
    },
  });

  await assert.rejects(() => service.accounts(), {
    code: "AUTH_REQUIRED",
  });
  const result = await service.accounts();
  await service.close();

  assert.equal(connections, 2);
  assert.equal(expiredCloses, 1);
  assert.equal(result.accounts[0].id, "account-1");
});

test("MCP service wraps local watchlist operations in stable documents", async () => {
  const service = createSarwaMcpService({
    addWatchlistItem: async (symbol, { note }) => ({
      changed: true,
      item: { note, symbol },
      items: [{ note, symbol }],
      updated_at: "2026-07-30T00:00:00.000Z",
    }),
    getWatchlist: async () => ({
      items: [{ note: null, symbol: "NVDA" }],
      updated_at: "2026-07-30T00:00:00.000Z",
    }),
    removeWatchlistItem: async (symbol) => ({
      changed: true,
      items: [],
      symbol,
      updated_at: "2026-07-30T00:01:00.000Z",
    }),
  });

  const listed = await service.agentWatchlist();
  const added = await service.addAgentWatchlist("AMD", "entry");
  const removed = await service.removeAgentWatchlist("AMD");

  assert.equal(listed.agent_watchlist.action, "list");
  assert.equal(added.agent_watchlist.item.symbol, "AMD");
  assert.equal(removed.agent_watchlist.symbol, "AMD");
});

test("MCP service serializes local watchlist writes behind active reads", async () => {
  let addCalls = 0;
  let releasePortfolio;
  let signalPortfolioStarted;
  const portfolioStarted = new Promise((resolve) => {
    signalPortfolioStarted = resolve;
  });
  const service = createSarwaMcpService({
    addWatchlistItem: async (symbol) => {
      addCalls += 1;
      return {
        changed: true,
        item: { note: null, symbol },
        items: [{ note: null, symbol }],
        updated_at: "2026-07-30T00:00:00.000Z",
      };
    },
    connectClient: async () => ({
      close: async () => {},
      portfolio: async () => {
        signalPortfolioStarted();
        return new Promise((resolve) => {
          releasePortfolio = () => resolve({ portfolio: { value: 100 } });
        });
      },
    }),
  });

  const portfolio = service.portfolio({});
  await portfolioStarted;
  const added = service.addAgentWatchlist("NVDA");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(addCalls, 0);

  releasePortfolio();
  await portfolio;
  await added;
  assert.equal(addCalls, 1);
  await service.close();
});

test("MCP cancellation closes active browser work and returns a stable error", async () => {
  const controller = new AbortController();
  let closes = 0;
  let rejectAccounts;
  let signalAccountsStarted;
  const accountsStarted = new Promise((resolve) => {
    signalAccountsStarted = resolve;
  });
  const service = createSarwaMcpService({
    connectClient: async () => ({
      accounts: async () => {
        signalAccountsStarted();
        return new Promise((_, reject) => {
          rejectAccounts = reject;
        });
      },
      close: async () => {
        closes += 1;
        rejectAccounts?.(new Error("browser closed"));
      },
    }),
  });

  const pending = service.accounts({ signal: controller.signal });
  await accountsStarted;
  controller.abort();

  await assert.rejects(pending, { code: "CANCELLED" });
  assert.equal(closes >= 1, true);
  await service.close();
});
