import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireProfileLock } from "../src/lock.js";

test("profile lock serializes concurrent browser users", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sarwa-lock-"));
  const lockPath = path.join(directory, "browser.lock");
  try {
    const first = await acquireProfileLock(lockPath, { timeoutMs: 1_000 });
    let secondAcquired = false;
    const secondPromise = acquireProfileLock(lockPath, {
      pollMs: 10,
      timeoutMs: 1_000,
    }).then((lock) => {
      secondAcquired = true;
      return lock;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(secondAcquired, false);
    await first.release();
    const second = await secondPromise;
    assert.equal(secondAcquired, true);
    await second.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("profile lock waiting stops promptly when cancelled", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sarwa-lock-abort-"));
  const lockPath = path.join(directory, "browser.lock");
  try {
    const first = await acquireProfileLock(lockPath, { timeoutMs: 1_000 });
    const controller = new AbortController();
    const waiting = acquireProfileLock(lockPath, {
      pollMs: 1_000,
      signal: controller.signal,
      timeoutMs: 10_000,
    });

    controller.abort();
    await assert.rejects(waiting, { code: "CANCELLED" });
    await first.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
