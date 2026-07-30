import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkAgentMonitor } from "../src/agent-service.js";
import { configPaths } from "../src/config.js";

test("monitor baselines are isolated by resolved account id", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "sarwa-monitor-accounts-"),
  );
  const paths = configPaths({ SARWA_CONFIG_DIR: directory });
  const observations = {
    "account-a": [
      snapshot("account-a", "2026-07-30T00:00:00.000Z", 100),
      snapshot("account-a", "2026-07-30T00:02:00.000Z", 110),
    ],
    "account-b": [
      snapshot("account-b", "2026-07-30T00:01:00.000Z", 900),
    ],
  };
  const client = {
    snapshot: async ({ account }) => observations[account].shift(),
  };

  try {
    const firstA = await checkAgentMonitor(client, {
      account: "account-a",
      paths,
    });
    const firstB = await checkAgentMonitor(client, {
      account: "account-b",
      paths,
    });
    const secondA = await checkAgentMonitor(client, {
      account: "account-a",
      paths,
    });

    assert.equal(firstA.monitor.baseline_at, "2026-07-30T00:00:00.000Z");
    assert.equal(firstB.monitor.baseline_at, "2026-07-30T00:01:00.000Z");
    assert.equal(secondA.monitor.baseline_at, "2026-07-30T00:00:00.000Z");
    assert.equal(secondA.monitor.portfolio_delta.value, 10);
    assert.equal(secondA.account_id, "account-a");

    const files = await readdir(directory);
    assert.equal(
      files.filter((file) => file.startsWith("monitor-state-")).length,
      2,
    );
    assert.equal(files.includes("monitor-state.json"), false);
    assert.equal(files.some((file) => file.includes("account-a")), false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

function snapshot(accountId, fetchedAt, value) {
  return {
    account_id: accountId,
    schema_version: "1.0",
    fetched_at: fetchedAt,
    source_as_of: null,
    partial: false,
    warnings: [],
    snapshot: {
      portfolio: {
        cash: 0,
        total_pnl: 0,
        value,
      },
      holdings: [],
      transactions: [],
      coverage: {
        transactions_complete: true,
        transactions_has_more: false,
      },
    },
  };
}
