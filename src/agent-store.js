import {
  buildMonitorState,
  diffMonitorStates,
  normalizeAgentSymbol,
  normalizeWatchlistNote,
} from "./agent.js";
import {
  configPaths,
  readJson,
  writePrivateJsonAtomic,
} from "./config.js";
import { SarwaError } from "./errors.js";
import { acquireProfileLock } from "./lock.js";

const STORAGE_VERSION = 1;

export async function listAgentWatchlist({ paths = configPaths() } = {}) {
  const state = await readLocalState(paths.agentWatchlist, emptyWatchlist());
  validateWatchlistState(state);
  return state;
}

export async function addAgentWatchlistItem(
  symbolValue,
  {
    note: noteValue,
    now = () => new Date(),
    paths = configPaths(),
  } = {},
) {
  const symbol = normalizeAgentSymbol(symbolValue);
  const note = normalizeWatchlistNote(noteValue);
  return withAgentStateLock(paths, async () => {
    const state = await listAgentWatchlist({ paths });
    const timestamp = now().toISOString();
    const existing = state.items.find((item) => item.symbol === symbol);
    let changed = false;
    let item;
    if (existing) {
      const nextNote = noteValue === undefined ? existing.note : note;
      changed = nextNote !== existing.note;
      item = changed
        ? { ...existing, note: nextNote, updated_at: timestamp }
        : existing;
      if (changed) {
        state.items = state.items.map((candidate) =>
          candidate.symbol === symbol ? item : candidate,
        );
      }
    } else {
      changed = true;
      item = {
        added_at: timestamp,
        note,
        symbol,
        updated_at: timestamp,
      };
      state.items.push(item);
      state.items.sort((left, right) => left.symbol.localeCompare(right.symbol));
    }
    if (changed) {
      state.updated_at = timestamp;
      await writePrivateJsonAtomic(paths.agentWatchlist, state);
    }
    return {
      changed,
      item,
      items: state.items,
      updated_at: state.updated_at,
    };
  });
}

export async function removeAgentWatchlistItem(
  symbolValue,
  {
    now = () => new Date(),
    paths = configPaths(),
  } = {},
) {
  const symbol = normalizeAgentSymbol(symbolValue);
  return withAgentStateLock(paths, async () => {
    const state = await listAgentWatchlist({ paths });
    const before = state.items.length;
    state.items = state.items.filter((item) => item.symbol !== symbol);
    const changed = state.items.length !== before;
    if (changed) {
      state.updated_at = now().toISOString();
      await writePrivateJsonAtomic(paths.agentWatchlist, state);
    }
    return {
      changed,
      items: state.items,
      symbol,
      updated_at: state.updated_at,
    };
  });
}

export async function runMonitorCheck(
  snapshotDocument,
  {
    now = () => new Date(),
    paths = configPaths(),
    reset = false,
  } = {},
) {
  return withAgentStateLock(paths, async () => {
    const capturedAt = now().toISOString();
    const current = buildMonitorState(snapshotDocument, capturedAt);
    const previous = await readMonitorState({ paths });
    const incomplete =
      Boolean(snapshotDocument.partial) ||
      snapshotDocument.snapshot?.coverage?.transactions_complete !== true;

    if (incomplete) {
      return {
        baseline_at: previous ? monitorObservationAt(previous) : null,
        changed: false,
        events: [],
        initialized: Boolean(previous),
        observed_at: current.observed_at,
        portfolio_delta: emptyPortfolioDelta(),
        reset: false,
        stale_observation: false,
        state_updated: false,
      };
    }

    if (
      previous &&
      Date.parse(current.observed_at) <=
        Date.parse(monitorObservationAt(previous))
    ) {
      return {
        baseline_at: monitorObservationAt(previous),
        changed: false,
        events: [],
        initialized: true,
        observed_at: current.observed_at,
        portfolio_delta: emptyPortfolioDelta(),
        reset: false,
        stale_observation: true,
        state_updated: false,
      };
    }

    if (!previous || reset) {
      await writePrivateJsonAtomic(paths.monitorState, current);
      return {
        baseline_at: current.observed_at,
        changed: false,
        events: [],
        initialized: true,
        observed_at: current.observed_at,
        portfolio_delta: emptyPortfolioDelta(),
        reset: Boolean(reset),
        stale_observation: false,
        state_updated: true,
      };
    }

    const comparison = diffMonitorStates(
      previous,
      current,
      snapshotDocument,
    );
    await writePrivateJsonAtomic(paths.monitorState, current);
    return {
      baseline_at: monitorObservationAt(previous),
      changed: comparison.changed,
      events: comparison.events,
      initialized: true,
      observed_at: current.observed_at,
      portfolio_delta: comparison.portfolio_delta,
      reset: false,
      stale_observation: false,
      state_updated: true,
    };
  });
}

export async function readMonitorState({ paths = configPaths() } = {}) {
  const state = await readLocalState(paths.monitorState, null);
  if (state === null) {
    return null;
  }
  validateMonitorState(state);
  return state;
}

async function withAgentStateLock(paths, callback) {
  const lock = await acquireProfileLock(paths.agentStateLock, {
    timeoutMs: 10_000,
  });
  try {
    return await callback();
  } finally {
    await lock.release();
  }
}

async function readLocalState(file, fallback) {
  try {
    return await readJson(file);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw new SarwaError(
      "LOCAL_STATE_INVALID",
      "Local agent state is unreadable. Move the affected JSON file aside and retry.",
      { cause: error, retryable: false },
    );
  }
}

function validateWatchlistState(state) {
  if (
    state?.storage_version !== STORAGE_VERSION ||
    (state.updated_at !== null && !validTimestamp(state.updated_at)) ||
    !Array.isArray(state.items)
  ) {
    throw invalidState("agent watchlist");
  }
  const symbols = new Set();
  for (const item of state.items) {
    if (
      !item ||
      typeof item !== "object" ||
      !isNormalizedSymbol(item.symbol) ||
      !isNormalizedNote(item.note) ||
      typeof item.added_at !== "string" ||
      typeof item.updated_at !== "string" ||
      !validTimestamp(item.added_at) ||
      !validTimestamp(item.updated_at) ||
      symbols.has(item.symbol)
    ) {
      throw invalidState("agent watchlist");
    }
    symbols.add(item.symbol);
  }
}

function validateMonitorState(state) {
  if (
    state?.storage_version !== STORAGE_VERSION ||
    typeof state.captured_at !== "string" ||
    !validTimestamp(state.captured_at) ||
    (state.observed_at !== undefined &&
      (typeof state.observed_at !== "string" ||
        !validTimestamp(state.observed_at))) ||
    !validPortfolio(state.portfolio) ||
    !Array.isArray(state.holdings) ||
    state.holdings.some(
      (holding) =>
        !holding ||
        typeof holding !== "object" ||
        !isNormalizedSymbol(holding.symbol) ||
        (holding.asset_class !== undefined &&
          holding.asset_class !== null &&
          typeof holding.asset_class !== "string") ||
        typeof holding.quantity !== "number" ||
        !Number.isFinite(holding.quantity),
    ) ||
    !Array.isArray(state.transaction_fingerprints) ||
    state.transaction_fingerprints.some(
      (fingerprint) => !/^[a-f0-9]{64}$/.test(fingerprint),
    ) ||
    !Array.isArray(state.watchlist_symbols) ||
    state.watchlist_symbols.some((symbol) => !isNormalizedSymbol(symbol))
  ) {
    throw invalidState("monitor baseline");
  }
}

function isNormalizedSymbol(value) {
  try {
    return normalizeAgentSymbol(value) === value;
  } catch {
    return false;
  }
}

function isNormalizedNote(value) {
  try {
    return normalizeWatchlistNote(value) === value;
  } catch {
    return false;
  }
}

function validPortfolio(portfolio) {
  if (!portfolio || typeof portfolio !== "object") {
    return false;
  }
  return ["cash", "total_pnl", "value"].every((field) => {
    const value = portfolio[field];
    return (
      value === null ||
      (typeof value === "number" && Number.isFinite(value))
    );
  });
}

function validTimestamp(value) {
  return !Number.isNaN(Date.parse(value));
}

function monitorObservationAt(state) {
  return state.observed_at || state.captured_at;
}

function invalidState(label) {
  return new SarwaError(
    "LOCAL_STATE_INVALID",
    `The local ${label} has an unsupported or invalid format.`,
    { retryable: false },
  );
}

function emptyWatchlist() {
  return {
    storage_version: STORAGE_VERSION,
    updated_at: null,
    items: [],
  };
}

function emptyPortfolioDelta() {
  return { cash: null, total_pnl: null, value: null };
}
