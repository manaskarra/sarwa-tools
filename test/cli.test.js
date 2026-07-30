import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
    "monitor",
    "snapshot",
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

test("local agent watchlist is manageable without Sarwa authentication", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "sarwa-cli-agent-"));
  const env = { ...process.env, SARWA_CONFIG_DIR: directory };
  try {
    const added = JSON.parse(
      execFileSync(
        process.execPath,
        [bin, "--compact", "watchlist", "add", "exm", "--note", "idea"],
        { encoding: "utf8", env },
      ),
    );
    assert.equal(added.agent_watchlist.changed, true);
    assert.equal(added.agent_watchlist.item.symbol, "EXM");

    const listed = JSON.parse(
      execFileSync(
        process.execPath,
        [bin, "--compact", "watchlist", "list"],
        { encoding: "utf8", env },
      ),
    );
    assert.deepEqual(
      listed.agent_watchlist.items.map((item) => item.symbol),
      ["EXM"],
    );

    const removed = JSON.parse(
      execFileSync(
        process.execPath,
        [bin, "--compact", "watchlist", "remove", "EXM"],
        { encoding: "utf8", env },
      ),
    );
    assert.equal(removed.agent_watchlist.changed, true);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("misspelled commands receive an actionable suggestion", () => {
  const result = spawnSync(
    process.execPath,
    [bin, "--compact", "holdigns"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr);
  assert.equal(error.error.code, "USAGE");
  assert.match(error.error.message, /Did you mean `holdings`/);
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

  for (const resource of ["snapshot", "monitor"]) {
    const agentSchema = JSON.parse(
      execFileSync(
        process.execPath,
        [bin, "--compact", resource, "--schema"],
        { encoding: "utf8" },
      ),
    );
    assert.equal(agentSchema.resource, resource);
  }
});

test("local watchlist leaf schemas do not mutate state", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "sarwa-cli-schema-"));
  const env = { ...process.env, SARWA_CONFIG_DIR: directory };
  try {
    for (const args of [
      ["watchlist", "list", "--schema"],
      ["watchlist", "add", "EXM", "--schema"],
      ["watchlist", "remove", "EXM", "--schema"],
    ]) {
      const schema = JSON.parse(
        execFileSync(process.execPath, [bin, "--compact", ...args], {
          encoding: "utf8",
          env,
        }),
      );
      assert.equal(schema.resource, "agent_watchlist");
    }

    const listed = JSON.parse(
      execFileSync(
        process.execPath,
        [bin, "--compact", "watchlist", "list"],
        { encoding: "utf8", env },
      ),
    );
    assert.deepEqual(listed.agent_watchlist.items, []);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
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
