import process from "node:process";

import { Command, Option } from "commander";

import {
  authenticationStatus,
  login,
  logout,
} from "./browser.js";
import {
  addAgentWatchlistItem,
  listAgentWatchlist,
  removeAgentWatchlistItem,
  runMonitorCheck,
} from "./agent-store.js";
import { attachAgentWatchlist } from "./agent.js";
import { SarwaClient } from "./client.js";
import { VERSION } from "./constants.js";
import { normalizeError, SarwaError } from "./errors.js";
import {
  errorDocument,
  formatMoney,
  formatNumber,
  formatPercentRatio,
  formatPercentValue,
  printJson,
  printSection,
  printTable,
  printWarning,
  sanitizeTerminalText,
  successDocument,
} from "./output.js";
import { schemaDocument } from "./schemas.js";

export async function run(argv) {
  validateTopLevelCommand(argv);
  const program = createProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (
      error?.code === "commander.helpDisplayed" ||
      error?.code === "commander.version"
    ) {
      return;
    }
    throw error;
  }
}

export function handleCliError(error, argv = process.argv) {
  const normalized = normalizeError(error);
  if (machineOutputFromArgv(argv)) {
    printJson(errorDocument(normalized), {
      compact: argv.includes("--compact"),
      stream: process.stderr,
    });
  } else {
    process.stderr.write(
      `sarwa: ${sanitizeTerminalText(normalized.message)}\n`,
    );
  }
  process.exitCode = normalized.exitCode;
  return normalized.exitCode;
}

function createProgram() {
  const program = new Command()
    .name("sarwa")
    .description("Unofficial read-only Sarwa portfolio CLI and Node API.")
    .version(VERSION)
    .option("--json", "force formatted JSON output")
    .option("--compact", "print one-line JSON")
    .option("--table", "force concise human-readable tables")
    .option("--quiet", "suppress non-essential warnings")
    .showSuggestionAfterError(true)
    .exitOverride()
    .configureOutput({
      outputError: () => {},
      writeErr: () => {},
      writeOut: (value) =>
        process.stdout.write(
          sanitizeTerminalText(value, { preserveWhitespace: true }),
        ),
    })
    .action(showPortfolio);

  const auth = program
    .command("auth")
    .description("Manage the secure local Sarwa session");

  auth
    .command("login")
    .description("Sign in or securely replace a legacy saved session")
    .addOption(
      new Option("--timeout <seconds>", "sign-in timeout")
        .default(600)
        .argParser(asPositiveInteger),
    )
    .action(showAuthLogin);

  auth
    .command("status")
    .description("Verify whether the saved session is authenticated")
    .action(showAuthStatus);

  auth
    .command("logout")
    .description("Delete the local browser session")
    .action(showAuthLogout);

  program
    .command("accounts")
    .description("List open Sarwa Trade accounts")
    .option("--schema", "print the response schema without authentication")
    .action(showAccounts);

  program
    .command("portfolio")
    .description("Show portfolio value, P&L, spend, cash, and top holdings")
    .option(
      "-a, --account <id>",
      "Trade account id (needed only for multiple accounts)",
    )
    .option("--schema", "print the response schema without authentication")
    .action(showPortfolio);

  program
    .command("holdings")
    .description("List holdings or inspect one symbol deeply")
    .argument("[symbol]", "symbol for current position and trading history")
    .option(
      "-a, --account <id>",
      "Trade account id (needed only for multiple accounts)",
    )
    .option("--asset-class <class>", "filter the holdings list by asset class")
    .addOption(
      new Option("--sort <field>", "sort the holdings list")
        .choices(["value", "pnl", "return", "symbol"])
        .default("value"),
    )
    .addOption(
      new Option("--limit <number>", "maximum holdings rows")
        .default(50)
        .argParser(asRowLimit),
    )
    .addOption(
      new Option("--history-limit <number>", "maximum deep-dive history rows")
        .default(20)
        .argParser(asRowLimit),
    )
    .option("--schema", "print the response schema without authentication")
    .action(showHoldings);

  program
    .command("transactions")
    .description("List portfolio activity with pagination and date filters")
    .option(
      "-a, --account <id>",
      "Trade account id (needed only for multiple accounts)",
    )
    .option("--symbol <symbol>", "filter by symbol")
    .option("--from <date>", "include activity on or after this date", asDate)
    .option("--to <date>", "include activity on or before this date", asDate)
    .option("--cursor <cursor>", "continue from an opaque next-page cursor")
    .option("--all", "retrieve complete available activity history")
    .addOption(
      new Option("--limit <number>", "maximum rows")
        .default(20)
        .argParser(asRowLimit),
    )
    .option("--schema", "print the response schema without authentication")
    .action(showTransactions);

  const watchlist = program
    .command("watchlist")
    .description("Show Sarwa market lists or manage the local agent watchlist")
    .addOption(
      new Option("--name <name>", "curated list")
        .choices(["most-popular", "top-movers"])
        .default("most-popular"),
    )
    .addOption(
      new Option("--limit <number>", "maximum rows")
        .default(20)
        .argParser(asRowLimit),
    )
    .option("--schema", "print the response schema without authentication")
    .action(showWatchlist);

  watchlist
    .command("list")
    .description("List locally tracked symbols")
    .option("--schema", "print the response schema without authentication")
    .action(showAgentWatchlist);

  watchlist
    .command("add")
    .description("Add or update a locally tracked symbol")
    .argument("<symbol>", "symbol to track")
    .option("--note <text>", "optional agent context (maximum 500 characters)")
    .option("--schema", "print the response schema without authentication")
    .action(addToAgentWatchlist);

  watchlist
    .command("remove")
    .description("Remove a locally tracked symbol")
    .argument("<symbol>", "symbol to stop tracking")
    .option("--schema", "print the response schema without authentication")
    .action(removeFromAgentWatchlist);

  program
    .command("snapshot")
    .description("Fetch one agent-ready portfolio snapshot")
    .option(
      "-a, --account <id>",
      "Trade account id (needed only for multiple accounts)",
    )
    .addOption(
      new Option(
        "--transactions <number>",
        "recent transaction rows to include",
      )
        .default(100)
        .argParser(asRowLimit),
    )
    .option("--all-transactions", "include complete available activity history")
    .option("--schema", "print the response schema without authentication")
    .action(showSnapshot);

  program
    .command("monitor")
    .description("Detect portfolio and local watchlist changes since the last run")
    .option(
      "-a, --account <id>",
      "Trade account id (needed only for multiple accounts)",
    )
    .option("--once", "run one check and exit (the default behavior)")
    .option("--reset", "replace the comparison baseline without emitting events")
    .option("--schema", "print the response schema without authentication")
    .action(showMonitor);

  return program;
}

async function showAuthLogin(options, command) {
  const result = await login({ timeoutSeconds: options.timeout });
  const document = successDocument("auth", result);
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  process.stdout.write("Sarwa session saved with OS-backed browser security.\n");
}

async function showAuthStatus(_options, command) {
  const status = await authenticationStatus();
  const document = successDocument("auth_status", status);
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  printTable([
    {
      authenticated: status.authenticated ? "yes" : "no",
      profile: status.profile_state,
    },
  ]);
}

async function showAuthLogout(_options, command) {
  const result = await logout();
  const document = successDocument("auth", result, {
    warnings: result.remote_session_revoked
      ? []
      : [
          "Local session removed; remote revocation is unavailable through Sarwa's unsupported web API.",
        ],
  });
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  process.stdout.write(
    result.local_session_removed
      ? "Local Sarwa session removed.\n"
      : "No local Sarwa session was present.\n",
  );
  emitWarnings(document, command);
}

async function showAccounts(options, command) {
  if (maybePrintSchema(options, command, "accounts")) {
    return;
  }
  const document = await withClient((client) => client.accounts());
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  printTable(
    document.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency || "—",
      status: account.status,
    })),
  );
  emitWarnings(document, command);
}

async function showPortfolio(options, command) {
  if (maybePrintSchema(options, command, "portfolio")) {
    return;
  }
  const document = await withClient((client) =>
    client.portfolio({ account: options.account }),
  );
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  printPortfolio(document.portfolio);
  emitWarnings(document, command);
}

async function showHoldings(symbol, options, command) {
  const resource = symbol ? "holding" : "holdings";
  if (maybePrintSchema(options, command, resource)) {
    return;
  }
  const document = await withClient((client) =>
    client.holdings({
      account: options.account,
      assetClass: options.assetClass,
      historyLimit: options.historyLimit,
      limit: options.limit,
      sort: options.sort,
      symbol,
    }),
  );
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  if (symbol) {
    printHoldingDive(document.holding);
  } else {
    printHoldings(document.holdings);
  }
  emitWarnings(document, command);
}

async function showTransactions(options, command) {
  if (maybePrintSchema(options, command, "transactions")) {
    return;
  }
  if (options.cursor && (options.all || options.from || options.to)) {
    throw new SarwaError(
      "USAGE",
      "--cursor cannot be combined with --all, --from, or --to.",
      { retryable: false },
    );
  }
  const document = await withClient((client) =>
    client.transactions({
      account: options.account,
      all: options.all,
      cursor: options.cursor,
      from: options.from,
      limit: options.limit,
      symbol: options.symbol,
      to: options.to,
    }),
  );
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  printTransactions(document.transactions);
  if (document.has_more) {
    process.stdout.write("More activity is available; use JSON `next_cursor`.\n");
  }
  emitWarnings(document, command);
}

async function showWatchlist(options, command) {
  if (maybePrintSchema(options, command, "watchlist")) {
    return;
  }
  const document = await withClient((client) =>
    client.watchlist({ limit: options.limit, name: options.name }),
  );
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  printTable(
    document.watchlist.assets.map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      class: asset.asset_class,
      price: formatMoney(asset.price),
      change: formatPercentValue(asset.change_pct),
    })),
  );
  emitWarnings(document, command);
}

async function showAgentWatchlist(options, command) {
  if (maybePrintSchema(options, command, "agent_watchlist")) {
    return;
  }
  const state = await listAgentWatchlist();
  const document = successDocument("agent_watchlist", {
    action: "list",
    changed: false,
    items: state.items,
    updated_at: state.updated_at,
  });
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  printAgentWatchlist(document.agent_watchlist.items);
}

async function addToAgentWatchlist(symbol, options, command) {
  if (maybePrintSchema(options, command, "agent_watchlist")) {
    return;
  }
  const result = await addAgentWatchlistItem(symbol, { note: options.note });
  const document = successDocument("agent_watchlist", {
    action: "add",
    ...result,
  });
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  process.stdout.write(
    result.changed
      ? `${result.item.symbol} saved to the local agent watchlist.\n`
      : `${result.item.symbol} is already on the local agent watchlist.\n`,
  );
}

async function removeFromAgentWatchlist(symbol, options, command) {
  if (maybePrintSchema(options, command, "agent_watchlist")) {
    return;
  }
  const result = await removeAgentWatchlistItem(symbol);
  const document = successDocument("agent_watchlist", {
    action: "remove",
    ...result,
  });
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  process.stdout.write(
    result.changed
      ? `${result.symbol} removed from the local agent watchlist.\n`
      : `${result.symbol} was not on the local agent watchlist.\n`,
  );
}

async function showSnapshot(options, command) {
  if (maybePrintSchema(options, command, "snapshot")) {
    return;
  }
  const document = await loadAgentSnapshot({
    account: options.account,
    allTransactions: options.allTransactions,
    transactionLimit: options.transactions,
  });
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  printAgentSnapshot(document.snapshot);
  emitWarnings(document, command);
}

async function showMonitor(options, command) {
  if (maybePrintSchema(options, command, "monitor")) {
    return;
  }
  const snapshotDocument = await loadAgentSnapshot({
    account: options.account,
    allTransactions: true,
  });
  const result = await runMonitorCheck(snapshotDocument, {
    reset: options.reset,
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
  const document = successDocument(
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
      fetchedAt: snapshotDocument.fetched_at,
      partial: snapshotDocument.partial,
      sourceAsOf: snapshotDocument.source_as_of,
      warnings,
    },
  );
  if (wantsJson(command)) {
    printStructured(document, command);
    return;
  }
  printMonitor(document.monitor);
  emitWarnings(document, command);
}

async function loadAgentSnapshot({
  account,
  allTransactions = false,
  transactionLimit = 100,
} = {}) {
  const watchlist = await listAgentWatchlist();
  const document = await withClient((client) =>
    client.snapshot({
      account,
      allTransactions,
      transactionLimit,
    }),
  );
  return attachAgentWatchlist(document, watchlist.items);
}

async function withClient(callback) {
  const client = await SarwaClient.connect();
  try {
    return await callback(client);
  } finally {
    await client.close();
  }
}

function maybePrintSchema(options, command, resource) {
  const resolvedOptions = command.optsWithGlobals();
  if (!options?.schema && !resolvedOptions.schema) {
    return false;
  }
  printJson(schemaDocument(resource), {
    compact: resolvedOptions.compact,
  });
  return true;
}

function wantsJson(command) {
  const options = command.optsWithGlobals();
  if (options.table) {
    return false;
  }
  return Boolean(options.json || options.compact || !process.stdout.isTTY);
}

function printStructured(value, command) {
  printJson(value, { compact: command.optsWithGlobals().compact });
}

function machineOutputFromArgv(argv) {
  return (
    argv.includes("--json") ||
    argv.includes("--compact") ||
    (!argv.includes("--table") && !process.stderr.isTTY)
  );
}

function emitWarnings(document, command) {
  if (command.optsWithGlobals().quiet) {
    return;
  }
  for (const warning of document.warnings || []) {
    printWarning(warning);
  }
}

function printPortfolio(view) {
  const currency = view.currency;
  printSection("Portfolio", [
    { metric: "Value", value: formatMoney(view.value, currency) },
    {
      metric: "Total P&L",
      value: `${formatMoney(view.total_pnl, currency)} · ${formatPercentValue(view.total_return_pct)}`,
    },
    {
      metric: "Net deposits",
      value: formatMoney(view.net_deposits, currency),
    },
    { metric: "Day P&L", value: formatMoney(view.day_pnl, currency) },
    {
      metric: "Holdings",
      value: `${view.holdings.count} · ${formatMoney(view.holdings.value, currency)}`,
    },
    {
      metric: "Unrealized P&L",
      value: `${formatMoney(view.holdings.unrealized_pnl, currency)} · ${formatPercentValue(view.holdings.unrealized_return_pct)}`,
    },
    { metric: "Cash", value: formatMoney(view.cash, currency) },
    {
      metric: "Gross buy spend",
      value: formatMoney(view.gross_buy_spend, currency),
    },
  ]);
  printSection(
    "Top holdings",
    view.holdings.top.map((holding) => ({
      symbol: holding.symbol,
      class: holding.asset_class,
      value: formatMoney(holding.value, currency),
      "P&L": formatMoney(holding.pnl, currency),
      return: formatPercentValue(holding.return_pct),
    })),
  );
}

function printHoldings(holdings) {
  printTable(
    holdings.map((holding) => ({
      symbol: holding.symbol,
      class: holding.asset_class,
      quantity: formatNumber(holding.quantity),
      price: formatMoney(holding.price),
      value: formatMoney(holding.value),
      "P&L": formatMoney(holding.pnl),
      return: formatPercentValue(holding.return_pct),
      day: formatMoney(holding.day_pnl),
    })),
  );
}

function printHoldingDive(dive) {
  printSection("Holding", [
    { metric: "Symbol", value: dive.symbol },
    {
      metric: "Position value",
      value: dive.holding ? formatMoney(dive.holding.value) : "No open position",
    },
    {
      metric: "Unrealized P&L",
      value: dive.holding ? formatMoney(dive.holding.pnl) : "—",
    },
    {
      metric: "Gross buy spend",
      value: formatMoney(dive.order_summary.gross_buy_spend),
    },
    {
      metric: "Gross sell proceeds",
      value: formatMoney(dive.order_summary.gross_sell_proceeds),
    },
  ]);
  printSection(
    "Recent activity",
    dive.transactions.map(transactionRow),
  );
}

function printTransactions(transactions) {
  printTable(transactions.map(transactionRow));
}

function printAgentWatchlist(items) {
  printTable(
    items.map((item) => ({
      symbol: item.symbol,
      note: item.note || "—",
      added: formatDate(item.added_at),
    })),
  );
}

function printAgentSnapshot(snapshot) {
  printPortfolio(snapshot.portfolio);
  printSection("Snapshot", [
    { metric: "Holdings", value: snapshot.holdings.length },
    { metric: "Transactions", value: snapshot.transactions.length },
    {
      metric: "Transaction history",
      value: snapshot.coverage.transactions_complete ? "complete" : "partial",
    },
    { metric: "Agent watchlist", value: snapshot.agent_watchlist.length },
  ]);
  printSection(
    "Agent watchlist",
    snapshot.agent_watchlist.map((item) => ({
      symbol: item.symbol,
      held: item.is_held ? "yes" : "no",
      note: item.note || "—",
    })),
  );
}

function printMonitor(monitor) {
  let status = monitor.changed ? "changes detected" : "no changes";
  if (monitor.reset) {
    status = "baseline reset";
  } else if (monitor.stale_observation) {
    status = "stale observation ignored";
  } else if (!monitor.baseline_at) {
    status = "snapshot incomplete; baseline not created";
  } else if (
    monitor.state_updated &&
    monitor.baseline_at === monitor.observed_at
  ) {
    status = "baseline created";
  }
  const currency = monitor.current.portfolio.currency;
  printSection("Monitor", [
    { metric: "Status", value: status },
    { metric: "Observed", value: monitor.observed_at },
    { metric: "Baseline", value: monitor.baseline_at || "—" },
    {
      metric: "Portfolio value change",
      value: formatMoney(monitor.portfolio_delta.value, currency),
    },
    {
      metric: "Total P&L change",
      value: formatMoney(monitor.portfolio_delta.total_pnl, currency),
    },
    {
      metric: "Cash change",
      value: formatMoney(monitor.portfolio_delta.cash, currency),
    },
  ]);
  printSection(
    "Events",
    monitor.events.map((item) => ({
      type: item.type,
      symbol:
        item.symbol ||
        item.holding?.symbol ||
        item.transaction?.symbol ||
        "—",
      detail: monitorEventDetail(item),
    })),
  );
}

function monitorEventDetail(item) {
  if (item.type === "position_quantity_changed") {
    return `${formatNumber(item.before_quantity)} → ${formatNumber(item.after_quantity)}`;
  }
  if (item.type === "position_opened" || item.type === "position_closed") {
    return `quantity ${formatNumber(item.holding?.quantity)}`;
  }
  if (item.type === "transaction_added") {
    const transaction = item.transaction;
    return [
      formatDate(transaction?.date),
      transaction?.type,
      transaction?.side,
      formatNumber(transaction?.quantity),
    ]
      .filter((value) => value && value !== "—")
      .join(" · ");
  }
  return item.type === "watchlist_added" ? "tracking started" : "tracking stopped";
}

function transactionRow(transaction) {
  return {
    date: formatDate(transaction.date),
    type: transaction.type || "—",
    symbol: transaction.symbol || "—",
    side: transaction.side || "—",
    quantity: formatNumber(transaction.quantity),
    price: formatMoney(transaction.price),
    amount: formatMoney(transaction.amount),
    status: transaction.status || "—",
  };
}

function asPositiveInteger(value) {
  if (!/^\d+$/.test(String(value))) {
    throw new SarwaError(
      "USAGE",
      `Expected a positive integer, received: ${value}`,
      { retryable: false },
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new SarwaError(
      "USAGE",
      `Expected a positive integer, received: ${value}`,
      { retryable: false },
    );
  }
  return parsed;
}

function asRowLimit(value) {
  const parsed = asPositiveInteger(value);
  if (parsed > 100) {
    throw new SarwaError("USAGE", "Row limit cannot exceed 100.", {
      retryable: false,
    });
  }
  return parsed;
}

function asDate(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isNaN(Date.parse(value))
  ) {
    throw new SarwaError(
      "USAGE",
      `Invalid date: ${value}. Use YYYY-MM-DD or ISO 8601.`,
      { retryable: false },
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const normalized = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(normalized.getTime()) ||
      normalized.toISOString().slice(0, 10) !== value
    ) {
      throw new SarwaError("USAGE", `Invalid calendar date: ${value}.`, {
        retryable: false,
      });
    }
  }
  return value;
}

function formatDate(value) {
  if (!value) {
    return "—";
  }
  return value.slice(0, 10);
}

const TOP_LEVEL_COMMANDS = [
  "accounts",
  "auth",
  "holdings",
  "monitor",
  "portfolio",
  "snapshot",
  "transactions",
  "watchlist",
];

function validateTopLevelCommand(argv) {
  const candidate = argv.slice(2).find((value) => !value.startsWith("-"));
  if (!candidate || TOP_LEVEL_COMMANDS.includes(candidate)) {
    return;
  }
  const suggestion = [...TOP_LEVEL_COMMANDS]
    .map((command) => ({
      command,
      distance: editDistance(candidate.toLowerCase(), command),
    }))
    .sort((left, right) => left.distance - right.distance)[0];
  const hint =
    suggestion && suggestion.distance <= 3
      ? ` Did you mean \`${suggestion.command}\`?`
      : "";
  throw new SarwaError(
    "USAGE",
    `Unknown command \`${candidate}\`.${hint}`,
    { retryable: false },
  );
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[right.length];
}
