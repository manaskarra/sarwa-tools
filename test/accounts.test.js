import assert from "node:assert/strict";
import test from "node:test";

import { resolveTradeAccountExternalId } from "../src/accounts.js";

function sessionWith(accounts) {
  return {
    get: async (path) => {
      assert.equal(path, "/api/account/list");
      return accounts;
    },
  };
}

const tradeAccount = {
  account_number: "number-1",
  external_account_id: "external-1",
  id: 42,
  is_closed: false,
  product: "TRADE",
};

test("sole open Trade account is selected automatically", async () => {
  assert.equal(
    await resolveTradeAccountExternalId(sessionWith([tradeAccount])),
    "external-1",
  );
});

test("internal and external identifiers resolve to the external trading id", async () => {
  const session = sessionWith([tradeAccount]);
  assert.equal(await resolveTradeAccountExternalId(session, "42"), "external-1");
  assert.equal(
    await resolveTradeAccountExternalId(session, "external-1"),
    "external-1",
  );
});

test("ambiguous or unknown account selection fails closed", async () => {
  const second = { ...tradeAccount, external_account_id: "external-2", id: 43 };
  await assert.rejects(
    () => resolveTradeAccountExternalId(sessionWith([tradeAccount, second])),
    /Multiple open Trade accounts/,
  );
  await assert.rejects(
    () => resolveTradeAccountExternalId(sessionWith([tradeAccount]), "missing"),
    /No open Trade account matches/,
  );
});
