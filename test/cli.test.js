import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const bin = fileURLToPath(new URL("../bin/sarwa.js", import.meta.url));

test("public command surface stays focused on portfolio reads", () => {
  const help = execFileSync(process.execPath, [bin, "--help"], {
    encoding: "utf8",
  });

  for (const command of [
    "auth",
    "accounts",
    "portfolio",
    "holdings",
    "watchlist",
    "transactions",
  ]) {
    assert.match(help, new RegExp(`^  ${command}(?: |$)`, "m"));
  }
  for (const removed of [
    "api",
    "deep-dive",
    "discover",
    "doctor",
    "endpoints",
    "get",
    "market-clock",
    "orders",
    "overview",
    "positions",
  ]) {
    assert.doesNotMatch(help, new RegExp(`^  ${removed}(?: |$)`, "m"));
  }
});

test("schemas are discoverable without authentication", () => {
  const result = execFileSync(
    process.execPath,
    [bin, "--compact", "portfolio", "--schema"],
    { encoding: "utf8" },
  );
  const schema = JSON.parse(result);

  assert.equal(schema.schema_version, "1.0");
  assert.equal(schema.resource, "portfolio");
  assert.equal(schema.type, "object");
});

test("agent errors are structured, stable, and free of terminal controls", () => {
  const result = spawnSync(
    process.execPath,
    [bin, "--compact", "holdings", "--sort", "bad\u001b[2J"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes("\u001b"), false);
  const error = JSON.parse(result.stderr);
  assert.equal(error.schema_version, "1.0");
  assert.equal(error.error.code, "USAGE");
  assert.equal(error.error.retryable, false);
});
