import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  addAgentWatchlistItem,
  listAgentWatchlist,
  removeAgentWatchlistItem,
  runMonitorCheck,
} from "../src/agent-store.js";
import { configPaths } from "../src/config.js";

function date(value) {
  return () => new Date(value);
}

function snapshot({
  partial = false,
  quantity = 1,
  transactions = [],
} = {}) {
  return {
    schema_version: "1.0",
    fetched_at: "2026-07-30T00:00:00.000Z",
    source_as_of: null,
    partial,
    warnings: [],
    snapshot: {
      agent_watchlist: [],
      coverage: {
        transactions_complete: true,
        transactions_has_more: false,
      },
      holdings: [{ quantity, symbol: "EXM" }],
      portfolio: { cash: 100, total_pnl: 20, value: 1_000 },
      transactions,
    },
  };
}

test("local watchlist writes are private, atomic, and idempotent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sarwa-agent-"));
  const paths = configPaths({ SARWA_CONFIG_DIR: directory });
  try {
    const first = await addAgentWatchlistItem(" exm ", {
      note: "first",
      now: date("2026-07-30T01:00:00.000Z"),
      paths,
    });
    assert.equal(first.changed, true);
    assert.equal(first.item.symbol, "EXM");
    assert.equal((await stat(paths.agentWatchlist)).mode & 0o777, 0o600);

    const second = await addAgentWatchlistItem("EXM", {
      now: date("2026-07-30T02:00:00.000Z"),
      paths,
    });
    assert.equal(second.changed, false);
    assert.equal(second.item.updated_at, "2026-07-30T01:00:00.000Z");

    const updated = await addAgentWatchlistItem("EXM", {
      note: "updated",
      now: date("2026-07-30T03:00:00.000Z"),
      paths,
    });
    assert.equal(updated.changed, true);
    assert.equal(updated.item.note, "updated");

    const listed = await listAgentWatchlist({ paths });
    assert.deepEqual(listed.items.map((item) => item.symbol), ["EXM"]);

    const removed = await removeAgentWatchlistItem("exm", {
      now: date("2026-07-30T04:00:00.000Z"),
      paths,
    });
    assert.equal(removed.changed, true);
    assert.deepEqual(removed.items, []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("invalid local watchlist state fails with a stable local-state error", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sarwa-agent-"));
  const paths = configPaths({ SARWA_CONFIG_DIR: directory });
  try {
    await writeFile(
      paths.agentWatchlist,
      JSON.stringify({
        storage_version: 1,
        updated_at: null,
        items: [
          {
            added_at: "bad-date",
            note: null,
            symbol: "../../BAD",
            updated_at: "bad-date",
          },
        ],
      }),
    );
    await assert.rejects(
      () => listAgentWatchlist({ paths }),
      (error) => error.code === "LOCAL_STATE_INVALID",
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("monitor advances only complete snapshots and supports reset", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sarwa-agent-"));
  const paths = configPaths({ SARWA_CONFIG_DIR: directory });
  try {
    const first = await runMonitorCheck(snapshot(), {
      now: date("2026-07-30T01:00:00.000Z"),
      paths,
    });
    assert.equal(first.state_updated, true);
    assert.equal(first.changed, false);

    const baseline = await readFile(paths.monitorState, "utf8");
    const incomplete = await runMonitorCheck(
      snapshot({ partial: true, quantity: 2 }),
      {
        now: date("2026-07-30T02:00:00.000Z"),
        paths,
      },
    );
    assert.equal(incomplete.state_updated, false);
    assert.equal(await readFile(paths.monitorState, "utf8"), baseline);

    const truncated = snapshot({ quantity: 2 });
    truncated.snapshot.coverage.transactions_complete = false;
    const incompleteHistory = await runMonitorCheck(truncated, {
      now: date("2026-07-30T02:30:00.000Z"),
      paths,
    });
    assert.equal(incompleteHistory.state_updated, false);
    assert.equal(await readFile(paths.monitorState, "utf8"), baseline);

    const changed = await runMonitorCheck(snapshot({ quantity: 2 }), {
      now: date("2026-07-30T03:00:00.000Z"),
      paths,
    });
    assert.equal(changed.changed, true);
    assert.deepEqual(
      changed.events.map((event) => event.type),
      ["position_quantity_changed"],
    );

    const reset = await runMonitorCheck(snapshot({ quantity: 3 }), {
      now: date("2026-07-30T04:00:00.000Z"),
      paths,
      reset: true,
    });
    assert.equal(reset.reset, true);
    assert.equal(reset.changed, false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
