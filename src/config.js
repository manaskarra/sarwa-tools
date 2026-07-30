import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SECURE_PROFILE_VERSION = 1;

export function platformConfigRoot(env = process.env) {
  if (env.SARWA_CONFIG_DIR) {
    return path.resolve(env.SARWA_CONFIG_DIR);
  }
  if (env.XDG_CONFIG_HOME) {
    return path.join(env.XDG_CONFIG_HOME, "sarwa-odyssey");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "sarwa-odyssey");
  }
  if (process.platform === "win32") {
    return path.join(
      env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "sarwa-odyssey",
    );
  }
  return path.join(os.homedir(), ".config", "sarwa-odyssey");
}

export function configPaths(env = process.env) {
  const root = platformConfigRoot(env);
  return {
    agentStateLock: path.join(root, "agent-state.lock"),
    agentWatchlist: path.join(root, "agent-watchlist.json"),
    lock: path.join(root, "browser.lock"),
    monitorState: path.join(root, "monitor-state.json"),
    profile: path.join(root, "browser-profile"),
    profileMarker: path.join(root, "secure-profile.json"),
    root,
  };
}

export async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700).catch(() => {});
}

export async function writePrivateJson(file, value) {
  await ensurePrivateDirectory(path.dirname(file));
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(file, 0o600).catch(() => {});
}

export async function writePrivateJsonAtomic(file, value) {
  await ensurePrivateDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporary, 0o600).catch(() => {});
    await rename(temporary, file);
    await chmod(file, 0o600).catch(() => {});
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function secureProfileState(paths = configPaths()) {
  const [profileExists, marker] = await Promise.all([
    exists(paths.profile),
    readJson(paths.profileMarker).catch(() => null),
  ]);
  if (!profileExists) {
    return "missing";
  }
  if (marker?.storage_version === SECURE_PROFILE_VERSION) {
    return "secure";
  }
  return "legacy";
}

export async function prepareSecureProfile({
  paths = configPaths(),
  resetLegacy = false,
} = {}) {
  const state = await secureProfileState(paths);
  if (state === "legacy" && !resetLegacy) {
    return { reset: false, state };
  }
  if (state === "legacy" && resetLegacy) {
    await rm(paths.profile, { force: true, recursive: true });
    await rm(paths.profileMarker, { force: true });
    return { reset: true, state: "missing" };
  }
  return { reset: false, state };
}

export async function markSecureProfile(paths = configPaths()) {
  await writePrivateJson(paths.profileMarker, {
    created_at: new Date().toISOString(),
    storage_version: SECURE_PROFILE_VERSION,
  });
}

export async function removeLocalSession(paths = configPaths()) {
  await rm(paths.profile, { force: true, recursive: true });
  await rm(paths.profileMarker, { force: true });
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
