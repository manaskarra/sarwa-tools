import { OUTPUT_SCHEMA_VERSION } from "./constants.js";

const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\|$)/g;
const ANSI_TWO_BYTE = /\u001b[@-_]/g;
const UNSAFE_CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function sanitizeTerminalText(value, { preserveWhitespace = false } = {}) {
  let text = String(value ?? "")
    .replace(ANSI_OSC, "")
    .replace(ANSI_CSI, "")
    .replace(ANSI_TWO_BYTE, "")
    .replace(BIDI_CONTROLS, "");
  if (preserveWhitespace) {
    text = text
      .replace(/\r\n?/g, "\n")
      .replace(UNSAFE_CONTROLS, (character) =>
        character === "\n" || character === "\t" ? character : "",
      );
    return text;
  }
  return text.replace(UNSAFE_CONTROLS, " ").replace(/\s+/g, " ").trim();
}

export function successDocument(
  resource,
  value,
  {
    fetchedAt = new Date().toISOString(),
    partial = false,
    sourceAsOf = null,
    warnings = [],
    ...metadata
  } = {},
) {
  return {
    schema_version: OUTPUT_SCHEMA_VERSION,
    fetched_at: fetchedAt,
    source_as_of: sourceAsOf,
    partial: Boolean(partial),
    warnings: [...warnings],
    ...metadata,
    [resource]: value,
  };
}

export function errorDocument(error) {
  return {
    schema_version: OUTPUT_SCHEMA_VERSION,
    error: {
      code: error.code,
      message: error.message,
      retryable: Boolean(error.retryable),
    },
  };
}

export function printJson(value, { compact = false, stream = process.stdout } = {}) {
  stream.write(`${JSON.stringify(value, null, compact ? 0 : 2)}\n`);
}

export function printTable(rows) {
  if (rows.length === 0) {
    process.stdout.write("No results.\n");
    return;
  }
  const sanitizedRows = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        sanitizeTerminalText(key),
        sanitizeTerminalText(value),
      ]),
    ),
  );
  const columns = Object.keys(sanitizedRows[0]);
  const widths = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.max(
        column.length,
        ...sanitizedRows.map((row) => String(row[column] ?? "").length),
      ),
    ]),
  );
  const render = (row) =>
    columns
      .map((column) => String(row[column] ?? "").padEnd(widths[column]))
      .join("  ")
      .trimEnd();
  process.stdout.write(
    `${render(Object.fromEntries(columns.map((column) => [column, column])))}\n`,
  );
  process.stdout.write(
    `${render(Object.fromEntries(columns.map((column) => [column, "-".repeat(widths[column])])))}\n`,
  );
  for (const row of sanitizedRows) {
    process.stdout.write(`${render(row)}\n`);
  }
}

export function formatMoney(value, currency = "USD") {
  if (value === null || value === undefined) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    currency,
    currencyDisplay: "code",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

export function formatNumber(value, maximumFractionDigits = 6) {
  if (value === null || value === undefined) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

export function formatPercentRatio(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    signDisplay: "exceptZero",
    style: "percent",
  }).format(value);
}

export function formatPercentValue(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  return (
    new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      signDisplay: "exceptZero",
      style: "decimal",
    }).format(value) + "%"
  );
}

export function printSection(title, rows) {
  process.stdout.write(`${sanitizeTerminalText(title)}\n`);
  printTable(rows);
  process.stdout.write("\n");
}

export function printWarning(message) {
  process.stderr.write(
    `${sanitizeTerminalText(`warning: ${message}`, {
      preserveWhitespace: true,
    })}\n`,
  );
}
