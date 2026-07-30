import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import {
  cancellationError,
  SarwaError,
  throwIfAborted,
} from "./errors.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 150;

export async function acquireProfileLock(
  lockPath,
  {
    pollMs = DEFAULT_POLL_MS,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  throwIfAborted(signal);
  await mkdir(path.dirname(lockPath), { mode: 0o700, recursive: true });
  const deadline = Date.now() + timeoutMs;
  const nonce = randomUUID();

  for (;;) {
    throwIfAborted(signal);
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify({
            created_at: new Date().toISOString(),
            nonce,
            pid: process.pid,
          })}\n`,
        );
      } finally {
        await handle.close();
      }
      return {
        release: async () => releaseOwnedLock(lockPath, nonce),
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }

    if (await removeStaleLock(lockPath)) {
      continue;
    }
    if (Date.now() >= deadline) {
      throw new SarwaError(
        "PROFILE_BUSY",
        "Another Sarwa command is using the secure browser session. Retry shortly.",
        { retryable: true },
      );
    }
    await delay(pollMs, signal);
  }
}

async function removeStaleLock(lockPath) {
  let record;
  try {
    record = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    return false;
  }

  if (!Number.isSafeInteger(record?.pid) || record.pid <= 0) {
    return false;
  }
  try {
    process.kill(record.pid, 0);
    return false;
  } catch (error) {
    if (error?.code !== "ESRCH") {
      return false;
    }
  }
  await unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  });
  return true;
}

async function releaseOwnedLock(lockPath, nonce) {
  let record;
  try {
    record = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (record?.nonce === nonce) {
    await unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    });
  }
}

function delay(milliseconds, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(cancellationError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
