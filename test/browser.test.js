import assert from "node:assert/strict";
import test from "node:test";

import {
  SarwaBrowserSession,
  browserLaunchOptions,
} from "../src/browser.js";

function response({ authorization = "JWT token", status = 200 } = {}) {
  return {
    request: () => ({
      headers: () => ({ authorization }),
    }),
    status: () => status,
    url: () => "https://apiv2.sarwa.co/api/v1/market-clock",
  };
}

test("authentication is captured only from successful Sarwa responses", () => {
  const session = new SarwaBrowserSession();
  session.observeResponse(response({ authorization: "JWT stale", status: 401 }));
  assert.equal(session.authHeader, null);

  session.observeResponse(response({ authorization: "JWT fresh", status: 200 }));
  assert.equal(session.authHeader, "JWT fresh");
});

test("non-Sarwa and malformed authorization responses are ignored", () => {
  const session = new SarwaBrowserSession();
  session.observeResponse({
    ...response(),
    url: () => "https://example.com/api",
  });
  session.observeResponse(response({ authorization: "not-a-jwt" }));
  assert.equal(session.authHeader, null);
});

test("authenticated browser launch is sandboxed and uses the OS credential store", () => {
  const options = browserLaunchOptions({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });

  assert.equal(options.chromiumSandbox, true);
  assert.deepEqual(options.ignoreDefaultArgs, [
    "--password-store=basic",
    "--use-mock-keychain",
  ]);
  assert.equal(options.acceptDownloads, false);
});
