import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReadOnlyPath,
  createLocalApiToken,
  isSarwaApiUrl,
  normalizeCapturedUrl,
  redact,
  safeEqual,
  schemaOf,
  structuralSample,
} from "../src/security.js";

test("only Sarwa HTTPS API URLs are accepted by default", () => {
  assert.equal(isSarwaApiUrl("https://apiv2.sarwa.co/api/v1/accounts"), true);
  assert.equal(isSarwaApiUrl("https://www.sarwa.co/trade"), true);
  assert.equal(isSarwaApiUrl("http://apiv2.sarwa.co/api/v1/accounts"), false);
  assert.equal(isSarwaApiUrl("https://sarwa.co.example.com/api"), false);
  assert.equal(isSarwaApiUrl("https://example.test/api", ["example.test"]), true);
});

test("advanced requests are constrained to first-party API GET paths", () => {
  assert.equal(
    assertReadOnlyPath("/api/v1/positions?limit=10"),
    "/api/v1/positions?limit=10",
  );
  assert.throws(() => assertReadOnlyPath("https://example.com/api/v1/accounts"));
  assert.throws(() => assertReadOnlyPath("/login"));
  assert.throws(() => assertReadOnlyPath("/api/v1/place-order/limit"));
  assert.throws(() => assertReadOnlyPath("/api/auth/logout"));
});

test("redaction removes sensitive values recursively", () => {
  assert.deepEqual(
    redact({
      account: { email: "person@example.com", id: "safe-id" },
      authorization: "JWT secret",
      positions: [{ symbol: "VOO" }],
    }),
    {
      account: { email: "[REDACTED]", id: "safe-id" },
      authorization: "[REDACTED]",
      positions: [{ symbol: "VOO" }],
    },
  );
});

test("structural samples preserve shape without preserving values", () => {
  assert.deepEqual(
    structuralSample({ active: true, balance: 42.5, items: [{ symbol: "VOO" }] }),
    { active: false, balance: 0, items: [{ symbol: "<string>" }] },
  );
});

test("schema generation emits object and array types", () => {
  assert.deepEqual(schemaOf({ positions: [{ quantity: 2 }] }), {
    properties: {
      positions: {
        items: {
          properties: { quantity: { type: "number" } },
          type: "object",
        },
        type: "array",
      },
    },
    type: "object",
  });
});

test("captured URLs discard query values and normalize identifiers", () => {
  assert.equal(
    normalizeCapturedUrl(
      "https://apiv2.sarwa.co/api/v1/accounts/550e8400-e29b-41d4-a716-446655440000?token=secret",
    ),
    "https://apiv2.sarwa.co/api/v1/accounts/%7Buuid%7D",
  );
});

test("safe equality handles equal and unequal values", () => {
  assert.equal(safeEqual("Bearer abc", "Bearer abc"), true);
  assert.equal(safeEqual("Bearer abc", "Bearer xyz"), false);
  assert.equal(safeEqual("", "Bearer xyz"), false);
});

test("local API tokens have at least 256 bits of random material", () => {
  assert.ok(createLocalApiToken().length >= 43);
});
