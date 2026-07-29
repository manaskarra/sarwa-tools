import assert from "node:assert/strict";
import test from "node:test";

import { listBuiltInEndpoints, resolveEndpoint } from "../src/endpoints.js";

test("built-in endpoints are read-only paths", () => {
  for (const endpoint of listBuiltInEndpoints()) {
    assert.match(endpoint.path, /^\/api\//);
  }
});

test("account endpoints require and encode safe ids", () => {
  assert.equal(
    resolveEndpoint("orders", { account: "abc-123" }),
    "/api/v2/orders/abc-123",
  );
  assert.throws(() => resolveEndpoint("orders"));
  assert.throws(() => resolveEndpoint("orders", { account: "../escape" }));
});

test("positions require the external trading account route", () => {
  assert.throws(() => resolveEndpoint("positions"), /requires --account/);
  assert.equal(
    resolveEndpoint("positions", { account: "account_1" }),
    "/api/v1/positions/account_1",
  );
});
