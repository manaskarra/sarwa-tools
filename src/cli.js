import process from "node:process";

import { Command, Option } from "commander";

import {
  authenticationStatus,
  login,
  logout,
} from "./browser.js";
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
    .showSuggestionAfterError(false)
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

  program
    .command("watchlist")
    .description("Show a Sarwa-curated market list")
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

async function withClient(callback) {
  const client = await SarwaClient.connect();
  try {
    return await callback(client);
  } finally {
    await client.close();
  }
}

function maybePrintSchema(options, command, resource) {
  if (!options?.schema) {
    return false;
  }
  printJson(schemaDocument(resource), {
    compact: command.optsWithGlobals().compact,
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
