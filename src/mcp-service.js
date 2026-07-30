import {
  addAgentWatchlistItem,
  listAgentWatchlist,
  removeAgentWatchlistItem,
} from "./agent-store.js";
import {
  checkAgentMonitor,
  loadAgentSnapshot,
} from "./agent-service.js";
import { authenticationStatus } from "./browser.js";
import { SarwaClient } from "./client.js";
import {
  cancellationError,
  SarwaError,
  throwIfAborted,
} from "./errors.js";
import { successDocument } from "./output.js";

export function createSarwaMcpService({
  addWatchlistItem = addAgentWatchlistItem,
  checkAuthentication = authenticationStatus,
  connectClient = (options) => SarwaClient.connect(options),
  getWatchlist = listAgentWatchlist,
  removeWatchlistItem = removeAgentWatchlistItem,
} = {}) {
  let activeClient = null;
  let closed = false;
  let operationQueue = Promise.resolve();
  const shutdown = new AbortController();

  function serialize(operation, { signal: callerSignal } = {}) {
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, shutdown.signal])
      : shutdown.signal;
    const run = async () => {
      throwIfAborted(signal);
      if (closed) {
        throw new SarwaError(
          "MCP_CLOSED",
          "The Sarwa MCP service is closed.",
          { retryable: false },
        );
      }
      return operation(signal);
    };
    const result = operationQueue.then(run, run);
    operationQueue = result.catch(() => {});
    return result;
  }

  function withClient(operation, context) {
    return serialize(async (signal) => {
      const client = await connectClient({ signal });
      activeClient = client;
      const onAbort = () => {
        void client.close().catch(() => {});
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        const result = await operation(client);
        throwIfAborted(signal);
        return result;
      } catch (error) {
        if (signal.aborted) {
          throw cancellationError();
        }
        throw error;
      } finally {
        signal.removeEventListener("abort", onAbort);
        if (activeClient === client) {
          activeClient = null;
        }
        await client.close();
      }
    }, context);
  }

  return {
    authStatus(context) {
      return serialize(async (signal) => {
        return successDocument(
          "auth_status",
          await checkAuthentication({ signal }),
        );
      }, context);
    },

    accounts(context) {
      return withClient((client) => client.accounts(), context);
    },

    portfolio(options, context) {
      return withClient(
        (client) => client.portfolio(options),
        context,
      );
    },

    holdings(options, context) {
      return withClient(
        (client) => client.holdings(options),
        context,
      );
    },

    transactions(options, context) {
      return withClient(
        (client) => client.transactions(options),
        context,
      );
    },

    marketWatchlist(options, context) {
      return withClient(
        (client) => client.watchlist(options),
        context,
      );
    },

    agentWatchlist(context) {
      return serialize(async () => {
        const state = await getWatchlist();
        return successDocument("agent_watchlist", {
          action: "list",
          changed: false,
          items: state.items,
          updated_at: state.updated_at,
        });
      }, context);
    },

    addAgentWatchlist(symbol, note, context) {
      return serialize(async () => {
        const result = await addWatchlistItem(symbol, { note });
        return successDocument("agent_watchlist", {
          action: "add",
          ...result,
        });
      }, context);
    },

    removeAgentWatchlist(symbol, context) {
      return serialize(async () => {
        const result = await removeWatchlistItem(symbol);
        return successDocument("agent_watchlist", {
          action: "remove",
          ...result,
        });
      }, context);
    },

    snapshot(options, context) {
      return withClient(
        (client) => loadAgentSnapshot(client, options),
        context,
      );
    },

    monitor(options, context) {
      return withClient(
        (client) => checkAgentMonitor(client, options),
        context,
      );
    },

    async close() {
      if (!closed) {
        closed = true;
        shutdown.abort();
        await activeClient?.close().catch(() => {});
      }
      await operationQueue;
    },
  };
}
