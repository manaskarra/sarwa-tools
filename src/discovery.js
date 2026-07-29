import { writePrivateJson } from "./config.js";
import { MAX_CAPTURE_BODY_BYTES, SARWA_WEB_URL } from "./constants.js";
import {
  isSarwaApiUrl,
  normalizeCapturedUrl,
  resourceId,
  schemaOf,
  structuralSample,
} from "./security.js";
import { SarwaBrowserSession } from "./browser.js";

export class ReadOnlyDiscovery {
  constructor({ additionalHosts = [] } = {}) {
    this.additionalHosts = additionalHosts;
    this.endpoints = new Map();
    this.harEntries = new Map();
    this.pending = new Set();
  }

  attach(context) {
    context.on("response", (response) => {
      const task = this.capture(response).finally(() => this.pending.delete(task));
      this.pending.add(task);
    });
  }

  async capture(response) {
    const request = response.request();
    const method = request.method().toUpperCase();
    if (!["GET", "HEAD"].includes(method)) {
      return;
    }
    if (!["fetch", "xhr"].includes(request.resourceType())) {
      return;
    }
    if (!isSarwaApiUrl(response.url(), this.additionalHosts)) {
      return;
    }

    const contentType = response.headers()["content-type"] || "";
    const contentLength = Number(response.headers()["content-length"] || 0);
    const normalizedUrl = normalizeCapturedUrl(response.url());
    const id = resourceId(method, response.url());
    const observed = {
      contentTypes: [contentType].filter(Boolean),
      id,
      method,
      observedAt: new Date().toISOString(),
      queryParameters: [...new URL(response.url()).searchParams.keys()].sort(),
      responseSchemas: [],
      statuses: [response.status()],
      url: normalizedUrl,
    };

    let sample = null;
    if (
      method === "GET" &&
      contentType.includes("json") &&
      (!contentLength || contentLength <= MAX_CAPTURE_BODY_BYTES)
    ) {
      try {
        const body = await response.json();
        observed.responseSchemas.push(schemaOf(body));
        sample = structuralSample(body);
      } catch {
        // Some JSON-labelled responses are empty or streamed.
      }
    }

    this.mergeEndpoint(observed);
    this.harEntries.set(id, createSanitizedHarEntry(request, response, sample));
  }

  mergeEndpoint(observed) {
    const existing = this.endpoints.get(observed.id);
    if (!existing) {
      this.endpoints.set(observed.id, observed);
      return;
    }
    existing.contentTypes = unique([...existing.contentTypes, ...observed.contentTypes]);
    existing.queryParameters = unique([
      ...existing.queryParameters,
      ...observed.queryParameters,
    ]);
    existing.statuses = unique([...existing.statuses, ...observed.statuses]);
    if (observed.responseSchemas.length > 0) {
      existing.responseSchemas = observed.responseSchemas;
    }
    existing.observedAt = observed.observedAt;
  }

  async drain() {
    await Promise.allSettled([...this.pending]);
  }

  contract() {
    return {
      generatedAt: new Date().toISOString(),
      mode: "read-only",
      note: "Request credentials and response values are intentionally omitted.",
      source: SARWA_WEB_URL,
      endpoints: [...this.endpoints.values()].sort((left, right) =>
        `${left.method} ${left.url}`.localeCompare(`${right.method} ${right.url}`),
      ),
    };
  }

  har() {
    return {
      log: {
        creator: { name: "sarwa-odyssey-cli", version: "0.2.1" },
        entries: [...this.harEntries.values()],
        version: "1.2",
      },
    };
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

function createSanitizedHarEntry(request, response, sample) {
  const url = new URL(request.url());
  return {
    startedDateTime: new Date().toISOString(),
    time: 0,
    request: {
      bodySize: 0,
      cookies: [],
      headers: [{ name: "Accept", value: "application/json" }],
      headersSize: -1,
      httpVersion: "HTTP/2",
      method: request.method(),
      queryString: [...url.searchParams.keys()].map((name) => ({
        name,
        value: "<redacted>",
      })),
      url: normalizeCapturedUrl(request.url()),
    },
    response: {
      bodySize: -1,
      content: {
        mimeType: response.headers()["content-type"] || "application/json",
        size: -1,
        text: sample === null ? "" : JSON.stringify(sample),
      },
      cookies: [],
      headers: [],
      headersSize: -1,
      httpVersion: "HTTP/2",
      redirectURL: "",
      status: response.status(),
      statusText: response.statusText(),
    },
    cache: {},
    timings: { receive: 0, send: 0, wait: 0 },
  };
}

export async function discover({
  additionalHosts = [],
  contractFile,
  harFile,
  seconds = 60,
} = {}) {
  const session = new SarwaBrowserSession({ headless: false });
  await session.open({ navigate: false });
  const discovery = new ReadOnlyDiscovery({ additionalHosts });
  discovery.attach(session.context);
  process.stdout.write(
    `Browse Sarwa normally for ${seconds} seconds. Only GET/HEAD schemas are captured; credentials and response values are omitted.\n`,
  );
  try {
    await session.page.goto(SARWA_WEB_URL, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    await session.page.waitForTimeout(seconds * 1000);
    await discovery.drain();
    await writePrivateJson(contractFile, discovery.contract());
    await writePrivateJson(harFile, discovery.har());
    return {
      contractFile,
      endpointCount: discovery.endpoints.size,
      harFile,
    };
  } finally {
    await session.close();
  }
}
