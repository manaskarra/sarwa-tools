import { READ_ENDPOINTS } from "./constants.js";
import { schemaError, SarwaError } from "./errors.js";

const ACCOUNT_MATCH_FIELDS = [
  "external_account_id",
  "id",
  "account_number",
  "external_account_number",
];

export async function resolveTradeAccountExternalId(session, requested) {
  const accounts = await session.get(READ_ENDPOINTS.accounts.path);
  if (!Array.isArray(accounts)) {
    throw schemaError("accounts", "must be an array");
  }

  const tradeAccounts = openTradeAccounts(accounts);

  if (requested !== undefined) {
    const expected = String(requested);
    const match = tradeAccounts.find((account) =>
      ACCOUNT_MATCH_FIELDS.some(
        (field) =>
          account[field] !== null &&
          account[field] !== undefined &&
          String(account[field]) === expected,
      ),
    );
    if (!match) {
      const available = tradeAccounts
        .map((account) => account.external_account_id)
        .join(", ");
      throw new SarwaError(
        "ACCOUNT_NOT_FOUND",
        `No open Trade account matches --account. Available account ids: ${available || "none"}.`,
        { retryable: false },
      );
    }
    return String(match.external_account_id);
  }

  if (tradeAccounts.length === 1) {
    return String(tradeAccounts[0].external_account_id);
  }
  if (tradeAccounts.length === 0) {
    throw new SarwaError(
      "ACCOUNT_NOT_FOUND",
      "No open Sarwa Trade account was found.",
      { retryable: false },
    );
  }
  throw new SarwaError(
    "ACCOUNT_REQUIRED",
    `Multiple open Trade accounts were found. Pass --account <id>. Available account ids: ${tradeAccounts
      .map((account) => account.external_account_id)
      .join(", ")}.`,
    { retryable: false },
  );
}

export async function listTradeAccounts(session) {
  const accounts = await session.get(READ_ENDPOINTS.accounts.path);
  if (!Array.isArray(accounts)) {
    throw schemaError("accounts", "must be an array");
  }
  return openTradeAccounts(accounts).map((account) => ({
    id: String(account.external_account_id),
    name:
      stringOrNull(account.name) ||
      stringOrNull(account.nickname) ||
      stringOrNull(account.account_name) ||
      "Trade",
    currency:
      stringOrNull(account.currency) ||
      stringOrNull(account.base_currency) ||
      null,
    status: "open",
  }));
}

function openTradeAccounts(accounts) {
  return accounts.filter(
    (account) =>
      account &&
      typeof account === "object" &&
      account.product === "TRADE" &&
      !account.is_closed &&
      account.external_account_id,
  );
}

function stringOrNull(value) {
  return value === null || value === undefined || value === ""
    ? null
    : String(value);
}
