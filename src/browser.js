import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright-core";

import {
  configPaths,
  ensurePrivateDirectory,
  markSecureProfile,
  prepareSecureProfile,
  removeLocalSession,
  secureProfileState,
} from "./config.js";
import {
  AUTH_HEADER_PATTERN,
  MAX_RESPONSE_BODY_BYTES,
  SARWA_API_ORIGIN,
  SARWA_WEB_URL,
} from "./constants.js";
import {
  authError,
  cancellationError,
  SarwaError,
  throwIfAborted,
} from "./errors.js";
import { acquireProfileLock } from "./lock.js";
import { assertReadOnlyPath } from "./security.js";

const CHROME_CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/microsoft-edge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_GET_ATTEMPTS = 3;
const BROWSER_LAUNCH_TIMEOUT_MS = 15_000;
const MANAGED_BROWSER_ERROR =
  /DevTools remote debugging is disallowed|remote debugging.+(?:administrator|admin|policy)|developer tools.+(?:administrator|admin|policy)/i;

export async function findBrowserExecutable(env = process.env) {
  for (const candidate of browserExecutableCandidates(env)) {
    try {
      await access(candidate);
      return candidate;
    } catch (error) {
      if (env.SARWA_BROWSER_EXECUTABLE) {
        throw new SarwaError(
          "BROWSER_NOT_FOUND",
          "SARWA_BROWSER_EXECUTABLE does not point to an accessible browser executable.",
          { cause: error, retryable: false },
        );
      }
      // Try the next supported system browser.
    }
  }
  return null;
}

export function browserExecutableCandidates(
  env = process.env,
  {
    platform = process.platform,
    playwrightExecutable = chromium.executablePath(),
  } = {},
) {
  if (env.SARWA_BROWSER_EXECUTABLE) {
    return [env.SARWA_BROWSER_EXECUTABLE];
  }
  return uniquePaths([
    playwrightExecutable,
    ...(CHROME_CANDIDATES[platform] || []),
  ]);
}

export function browserLaunchOptions({ executablePath, headless }) {
  return {
    acceptDownloads: false,
    chromiumSandbox: true,
    executablePath,
    headless,
    ignoreDefaultArgs: [
      "--password-store=basic",
      "--use-mock-keychain",
    ],
    serviceWorkers: "allow",
    timeout: BROWSER_LAUNCH_TIMEOUT_MS,
    viewport: { height: 900, width: 1440 },
  };
}

export function normalizeBrowserLaunchError(error) {
  const detail = String(error?.message || "");
  if (/ProcessSingleton|profile.*in use/i.test(detail)) {
    return new SarwaError(
      "PROFILE_BUSY",
      "Another browser is using the Sarwa session profile. Close it and retry.",
      { cause: error, retryable: true },
    );
  }
  if (MANAGED_BROWSER_ERROR.test(detail)) {
    return new SarwaError(
      "BROWSER_AUTOMATION_BLOCKED",
      "Browser automation is blocked by an administrator policy. Install a compatible browser with `npx playwright-core@1.62.0 install chromium`, then retry, or set SARWA_BROWSER_EXECUTABLE to an unmanaged Chromium executable.",
      { cause: error, retryable: false },
    );
  }
  if (/timed? ?out|timeout/i.test(detail)) {
    return new SarwaError(
      "BROWSER_LAUNCH_TIMEOUT",
      "Browser startup timed out. Managed Chrome installations may block automation. Install a compatible browser with `npx playwright-core@1.62.0 install chromium`, then retry.",
      { cause: error, retryable: true },
    );
  }
  return new SarwaError(
    "BROWSER_LAUNCH_FAILED",
    "The supported browser could not be started. Set SARWA_BROWSER_EXECUTABLE to an unmanaged Chrome, Edge, or Chromium executable.",
    { cause: error, retryable: false },
  );
}

export class SarwaBrowserSession {
  constructor({
    authTimeoutMs = 20_000,
    headless = true,
    lockPath,
    lockTimeoutMs = 60_000,
    profileDirectory = configPaths().profile,
    resetLegacyProfile = false,
    signal,
    webUrl = SARWA_WEB_URL,
  } = {}) {
    this.authHeader = null;
    this.authTimeoutMs = authTimeoutMs;
    this.authWaiters = new Set();
    this.context = null;
    this.headless = headless;
    this.lock = null;
    this.lockPath =
      lockPath || path.join(path.dirname(profileDirectory), "browser.lock");
    this.lockTimeoutMs = lockTimeoutMs;
    this.page = null;
    this.profileDirectory = profileDirectory;
    this.profilePaths = {
      ...configPaths(),
      lock: this.lockPath,
      profile: profileDirectory,
      profileMarker: path.join(
        path.dirname(profileDirectory),
        "secure-profile.json",
      ),
      root: path.dirname(profileDirectory),
    };
    this.resetLegacyProfile = resetLegacyProfile;
    this.signal = signal;
    this.webUrl = webUrl;
  }

  async open({ navigate = true } = {}) {
    throwIfAborted(this.signal);
    this.lock = await acquireProfileLock(this.lockPath, {
      signal: this.signal,
      timeoutMs: this.lockTimeoutMs,
    });
    try {
      throwIfAborted(this.signal);
      await ensurePrivateDirectory(this.profilePaths.root);
      const prepared = await prepareSecureProfile({
        paths: this.profilePaths,
        resetLegacy: this.resetLegacyProfile,
      });
      if (prepared.state === "legacy") {
        throw authError(
          "The saved session uses legacy browser encryption. Run `sarwa auth login` once to migrate securely.",
          "AUTH_MIGRATION_REQUIRED",
        );
      }
      await ensurePrivateDirectory(this.profileDirectory);
      const executablePath = await findBrowserExecutable();
      if (!executablePath) {
        throw new SarwaError(
          "BROWSER_NOT_FOUND",
          "No supported Chrome, Edge, or Chromium installation was found. Set SARWA_BROWSER_EXECUTABLE to an absolute path.",
          { retryable: false },
        );
      }

      try {
        this.context = await chromium.launchPersistentContext(
          this.profileDirectory,
          browserLaunchOptions({
            executablePath,
            headless: this.headless,
          }),
        );
      } catch (error) {
        throw normalizeBrowserLaunchError(error);
      }
      throwIfAborted(this.signal);
      this.context.on("response", (response) => this.observeResponse(response));
      this.page = this.context.pages()[0] || (await this.context.newPage());
      if (navigate && this.page.url() !== this.webUrl) {
        await this.page.goto(this.webUrl, {
          timeout: 30_000,
          waitUntil: "domcontentloaded",
        });
      }
      return this;
    } catch (error) {
      await this.context?.close().catch(() => {});
      this.context = null;
      this.page = null;
      await this.releaseLock();
      if (/ProcessSingleton|profile.*in use/i.test(error?.message || "")) {
        throw new SarwaError(
          "PROFILE_BUSY",
          "Another browser is using the Sarwa session profile. Close it and retry.",
          { cause: error, retryable: true },
        );
      }
      throw error;
    }
  }

  observeResponse(response) {
    if (response.status() < 200 || response.status() >= 400) {
      return;
    }
    const request = response.request();
    let url;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    if (url.origin !== SARWA_API_ORIGIN) {
      return;
    }
    const header = request.headers().authorization;
    if (!header || !AUTH_HEADER_PATTERN.test(header)) {
      return;
    }
    this.authHeader = header;
    for (const resolve of this.authWaiters) {
      resolve(header);
    }
    this.authWaiters.clear();
  }

  async waitForAuthentication(
    timeoutMs = this.authTimeoutMs,
    signal = this.signal,
  ) {
    throwIfAborted(signal);
    if (this.authHeader) {
      return this.authHeader;
    }
    let timeout;
    let waiter;
    let onAbort;
    try {
      return await Promise.race([
        new Promise((resolve) => {
          waiter = resolve;
          this.authWaiters.add(resolve);
        }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            reject(
              authError(
                this.headless
                  ? "No authenticated Sarwa session was found. Run `sarwa auth login`."
                  : "Timed out waiting for Sarwa sign-in.",
              ),
            );
          }, timeoutMs);
        }),
        new Promise((_, reject) => {
          if (!signal) {
            return;
          }
          onAbort = () => reject(cancellationError());
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      if (onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
      if (waiter) {
        this.authWaiters.delete(waiter);
      }
    }
  }

  async get(pathValue) {
    const safePath = assertReadOnlyPath(pathValue);
    let response = await this.requestGet(safePath);
    if (response.status() === 401) {
      await response.dispose().catch(() => {});
      this.authHeader = null;
      await this.page.reload({ timeout: 30_000, waitUntil: "domcontentloaded" });
      await this.waitForAuthentication();
      response = await this.requestGet(safePath);
    }
    return readApiResponse(response);
  }

  async requestGet(pathValue) {
    const authorization = await this.waitForAuthentication();
    for (let attempt = 1; attempt <= MAX_GET_ATTEMPTS; attempt += 1) {
      const response = await this.context.request.get(
        `${SARWA_API_ORIGIN}${pathValue}`,
        {
          failOnStatusCode: false,
          headers: {
            Accept: "application/json",
            Authorization: authorization,
          },
          timeout: 30_000,
        },
      );
      if (
        !RETRYABLE_STATUSES.has(response.status()) ||
        attempt === MAX_GET_ATTEMPTS
      ) {
        return response;
      }
      const waitMs = retryDelayMs(response, attempt);
      await response.dispose().catch(() => {});
      await delay(waitMs);
    }
    throw new SarwaError(
      "UPSTREAM_UNAVAILABLE",
      "Sarwa did not return a usable response.",
      { retryable: true },
    );
  }

  async close() {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
    } finally {
      await this.releaseLock();
    }
  }

  async releaseLock() {
    if (this.lock) {
      const lock = this.lock;
      this.lock = null;
      await lock.release();
    }
  }
}

export async function withAuthenticatedSession(callback, options = {}) {
  const session = await new SarwaBrowserSession(options).open();
  try {
    await session.waitForAuthentication(options.authTimeoutMs);
    return await callback(session);
  } finally {
    await session.close();
  }
}

export async function login({ timeoutSeconds = 600 } = {}) {
  const session = await new SarwaBrowserSession({
    headless: false,
    resetLegacyProfile: true,
  }).open();
  process.stdout.write(
    "Complete sign-in in the opened browser. This CLI never reads your password or MFA code.\n",
  );
  try {
    await session.waitForAuthentication(timeoutSeconds * 1000);
    await markSecureProfile(session.profilePaths);
    await session.page.waitForTimeout(500);
    return {
      authenticated: true,
      migrated_to_os_credential_store: true,
    };
  } finally {
    await session.close();
  }
}

export async function authenticationStatus({ signal } = {}) {
  const paths = configPaths();
  const state = await secureProfileState(paths);
  if (state !== "secure") {
    return {
      authenticated: false,
      profile_state: state,
    };
  }
  const session = new SarwaBrowserSession({
    authTimeoutMs: 10_000,
    headless: true,
    signal,
  });
  try {
    await session.open();
    await session.waitForAuthentication();
    return {
      authenticated: true,
      profile_state: "secure",
    };
  } catch (error) {
    if (error?.code === "AUTH_REQUIRED") {
      return {
        authenticated: false,
        profile_state: "expired",
      };
    }
    throw error;
  } finally {
    await session.close();
  }
}

export async function logout() {
  const paths = configPaths();
  const lock = await acquireProfileLock(paths.lock);
  try {
    const previousState = await secureProfileState(paths);
    await removeLocalSession(paths);
    return {
      local_session_removed: previousState !== "missing",
      remote_session_revoked: false,
    };
  } finally {
    await lock.release();
  }
}

async function readApiResponse(response) {
  const status = response.status();
  if (status === 401) {
    await response.dispose().catch(() => {});
    throw authError("Sarwa rejected the saved session. Run `sarwa auth login`.");
  }
  if (status === 429) {
    await response.dispose().catch(() => {});
    throw new SarwaError(
      "RATE_LIMITED",
      "Sarwa rate-limited the request after three attempts. Retry later.",
      { retryable: true },
    );
  }
  if (status >= 500) {
    await response.dispose().catch(() => {});
    throw new SarwaError(
      "UPSTREAM_UNAVAILABLE",
      `Sarwa remained unavailable after three attempts (HTTP ${status}).`,
      { retryable: true },
    );
  }
  if (status === 404) {
    await response.dispose().catch(() => {});
    throw new SarwaError(
      "UPSTREAM_ENDPOINT_CHANGED",
      "A Sarwa read endpoint is no longer available. Check for a CLI update.",
      { retryable: false },
    );
  }
  if (status < 200 || status >= 400) {
    await response.dispose().catch(() => {});
    throw new SarwaError(
      "UPSTREAM_HTTP_ERROR",
      `Sarwa returned HTTP ${status}.`,
      { retryable: false },
    );
  }

  const contentType = response.headers()["content-type"] || "";
  if (!contentType.toLowerCase().includes("json")) {
    await response.dispose().catch(() => {});
    throw new SarwaError(
      "UPSTREAM_SCHEMA_CHANGED",
      "Sarwa returned a non-JSON response for a portfolio read.",
      { retryable: false },
    );
  }
  const body = await response.body();
  await response.dispose().catch(() => {});
  if (body.length > MAX_RESPONSE_BODY_BYTES) {
    throw new SarwaError(
      "UPSTREAM_RESPONSE_TOO_LARGE",
      "Sarwa returned a response larger than the 10 MiB safety limit.",
      { retryable: true },
    );
  }
  try {
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new SarwaError(
      "UPSTREAM_SCHEMA_CHANGED",
      "Sarwa returned invalid JSON for a portfolio read.",
      { cause: error, retryable: false },
    );
  }
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers()["retry-after"];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 30_000);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.min(Math.max(date - Date.now(), 0), 30_000);
    }
  }
  return 250 * 2 ** (attempt - 1);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((value) => path.resolve(value)))];
}
