import assert from "node:assert/strict";
import test from "node:test";

import {
  errorDocument,
  sanitizeTerminalText,
  successDocument,
} from "../src/output.js";

test("terminal text neutralizes CSI, OSC, controls, and bidi overrides", () => {
  const value =
    "SAFE\u001b[2J\u001b]2;spoofed\u0007\r\nمرحبا\u202eEVIL\u202c";
  const sanitized = sanitizeTerminalText(value);

  assert.equal(sanitized.includes("\u001b"), false);
  assert.equal(sanitized.includes("\u0007"), false);
  assert.equal(sanitized.includes("\u202e"), false);
  assert.equal(sanitized.includes("\u202c"), false);
  assert.match(sanitized, /SAFE/);
  assert.match(sanitized, /مرحبا/);
});

test("agent documents have stable versioned success and error envelopes", () => {
  const success = successDocument("portfolio", { value: 10 }, {
    fetchedAt: "2026-01-01T00:00:00.000Z",
    sourceAsOf: null,
  });
  assert.deepEqual(success, {
    schema_version: "1.0",
    fetched_at: "2026-01-01T00:00:00.000Z",
    source_as_of: null,
    partial: false,
    warnings: [],
    portfolio: { value: 10 },
  });

  assert.deepEqual(
    errorDocument({
      code: "AUTH_REQUIRED",
      message: "Sign in.",
      retryable: false,
    }),
    {
      schema_version: "1.0",
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in.",
        retryable: false,
      },
    },
  );
});
