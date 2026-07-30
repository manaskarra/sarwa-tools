import {
  listAgentWatchlist,
  runMonitorCheck,
} from "./agent-store.js";
import { attachAgentWatchlist } from "./agent.js";
import {
  accountMonitorConfigPaths,
  configPaths,
} from "./config.js";
import { successDocument } from "./output.js";

export async function loadAgentSnapshot(
  client,
  {
    account,
    allTransactions = false,
    paths = configPaths(),
    transactionLimit = 100,
  } = {},
) {
  const watchlist = await listAgentWatchlist({ paths });
  const document = await client.snapshot({
    account,
    allTransactions,
    transactionLimit,
  });
  return attachAgentWatchlist(document, watchlist.items);
}

export async function checkAgentMonitor(
  client,
  {
    account,
    paths = configPaths(),
    reset = false,
  } = {},
) {
  const snapshotDocument = await loadAgentSnapshot(client, {
    account,
    allTransactions: true,
    paths,
  });
  const result = await runMonitorCheck(snapshotDocument, {
    paths: accountMonitorConfigPaths(
      snapshotDocument.account_id,
      paths,
    ),
    reset,
  });
  const warnings = [...snapshotDocument.warnings];
  if (!result.state_updated) {
    warnings.push(
      result.stale_observation
        ? "Monitor baseline was not updated because the same or a newer observation is already stored."
        : "Monitor baseline was not updated because the Sarwa snapshot was partial.",
    );
  }
  const snapshot = snapshotDocument.snapshot;
  return successDocument(
    "monitor",
    {
      ...result,
      current: {
        coverage: snapshot.coverage,
        holdings_count: snapshot.holdings.length,
        portfolio: snapshot.portfolio,
        transactions_count: snapshot.transactions.length,
        watchlist_count: snapshot.agent_watchlist.length,
      },
    },
    {
      account_id: snapshotDocument.account_id,
      fetchedAt: snapshotDocument.fetched_at,
      partial: snapshotDocument.partial,
      sourceAsOf: snapshotDocument.source_as_of,
      warnings,
    },
  );
}
