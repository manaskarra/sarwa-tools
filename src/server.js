import http from "node:http";

import { DEFAULT_API_PORT } from "./constants.js";
import { resolveEndpoint } from "./endpoints.js";
import { createLocalApiToken, safeEqual } from "./security.js";
import { SarwaBrowserSession } from "./browser.js";

export function resolveGatewayRoute(url) {
  const account = url.searchParams.get("account_id") || undefined;
  switch (url.pathname) {
    case "/v1/accounts":
      return resolveEndpoint("accounts");
    case "/v1/portfolio":
      return resolveEndpoint("portfolio");
    case "/v1/positions":
      return resolveEndpoint("positions", { account });
    case "/v1/orders":
      return resolveEndpoint("orders", { account });
    case "/v1/transactions":
      return resolveEndpoint("transactions", { account });
    case "/v1/market-clock":
      return resolveEndpoint("marketClock");
    default:
      return null;
  }
}

export async function startApiServer({
  host = "127.0.0.1",
  port = DEFAULT_API_PORT,
  token = process.env.SARWA_LOCAL_API_TOKEN || createLocalApiToken(),
} = {}) {
  if (typeof token !== "string" || token.length < 32) {
    throw new Error("SARWA_LOCAL_API_TOKEN must be at least 32 characters.");
  }
  if (host !== "127.0.0.1") {
    throw new Error("The local API is restricted to 127.0.0.1.");
  }
  const session = await new SarwaBrowserSession({ headless: true }).open();
  try {
    await session.waitForAuthentication();
  } catch (error) {
    await session.close();
    throw error;
  }

  const server = http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    if (request.method !== "GET") {
      return sendJson(response, 405, { error: "read_only", message: "Only GET is allowed." });
    }
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (url.pathname === "/healthz") {
      return sendJson(response, 200, { mode: "read-only", ok: true });
    }

    const expected = `Bearer ${token}`;
    if (!safeEqual(request.headers.authorization || "", expected)) {
      return sendJson(response, 401, { error: "unauthorized" });
    }

    let sarwaPath;
    try {
      sarwaPath = resolveGatewayRoute(url);
    } catch (error) {
      return sendJson(response, 400, { error: "bad_request", message: error.message });
    }
    if (!sarwaPath) {
      return sendJson(response, 404, {
        error: "not_found",
        routes: [
          "/v1/accounts",
          "/v1/portfolio",
          "/v1/positions?account_id=...",
          "/v1/orders?account_id=...",
          "/v1/transactions?account_id=...",
          "/v1/market-clock",
        ],
      });
    }

    try {
      return sendJson(response, 200, await session.get(sarwaPath));
    } catch (error) {
      return sendJson(response, 502, {
        error: "sarwa_upstream_error",
        message: error.message,
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    close: async () => {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await session.close();
    },
    host,
    port: actualPort,
    server,
    token,
  };
}

function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}
