import { SarwaError, schemaError } from "./errors.js";
import { assertReadOnlyPath } from "./security.js";

const MAX_CURSOR_LENGTH = 4096;

export function encodeCursor(path) {
  return Buffer.from(assertReadOnlyPath(path), "utf8").toString("base64url");
}

export function decodeCursor(cursor, { expectedPathPrefix } = {}) {
  if (
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    cursor.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    throw invalidCursor();
  }
  let decoded;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw invalidCursor();
  }
  let safePath;
  try {
    safePath = assertReadOnlyPath(decoded);
  } catch {
    throw invalidCursor();
  }
  if (expectedPathPrefix) {
    const url = new URL(safePath, "https://apiv2.sarwa.co");
    if (url.pathname !== expectedPathPrefix) {
      throw invalidCursor();
    }
  }
  return safePath;
}

export async function fetchPage(session, path) {
  const safePath = assertReadOnlyPath(path);
  const response = await session.get(safePath);
  const data = requirePageData(response);
  const nextPath = nextPagePath(response);
  return {
    nextCursor: nextPath ? encodeCursor(nextPath) : null,
    response,
    sourceAsOf: extractSourceTimestamp(response),
    count: data.length,
  };
}

export async function fetchAllPages(
  session,
  path,
  { maxPages = 250, pageSize = 100 } = {},
) {
  let currentPath = withPage(path, 1, pageSize);
  let pageNumber = 1;
  const allData = [];
  const warnings = [];
  const seenPaths = new Set();
  const seenFingerprints = new Set();
  let firstResponse = null;
  let partial = false;
  let sourceAsOf = null;
  let pages = 0;

  while (currentPath && pages < maxPages) {
    currentPath = assertReadOnlyPath(currentPath);
    if (seenPaths.has(currentPath)) {
      partial = true;
      warnings.push("Pagination returned a repeated next-page link.");
      break;
    }
    seenPaths.add(currentPath);

    const response = await session.get(currentPath);
    const data = requirePageData(response);
    const fingerprint = pageFingerprint(data);
    if (seenFingerprints.has(fingerprint) && data.length > 0) {
      partial = true;
      warnings.push("Pagination returned repeated data; history may be incomplete.");
      break;
    }
    seenFingerprints.add(fingerprint);

    firstResponse ||= response;
    allData.push(...data);
    pages += 1;
    sourceAsOf = newestTimestamp(sourceAsOf, extractSourceTimestamp(response));

    const explicitNext = nextPagePath(response);
    if (explicitNext) {
      currentPath = explicitNext;
      continue;
    }
    if (data.length === pageSize) {
      pageNumber += 1;
      currentPath = withPage(path, pageNumber, pageSize);
      continue;
    }
    currentPath = null;
  }

  if (currentPath) {
    partial = true;
    warnings.push(`Pagination stopped after the ${maxPages}-page safety limit.`);
  }

  return {
    nextCursor: currentPath ? encodeCursor(currentPath) : null,
    pages,
    partial,
    response: {
      ...(firstResponse && typeof firstResponse === "object"
        ? firstResponse
        : {}),
      data: allData,
      links: {
        ...(firstResponse?.links || {}),
        next: currentPath,
      },
    },
    sourceAsOf,
    warnings,
  };
}

export function extractSourceTimestamp(value) {
  const candidates = [
    value?.meta?.as_of,
    value?.meta?.updated_at,
    value?.as_of,
    value?.updated_at,
    value?.data?.attributes?.as_of,
    value?.data?.attributes?.updated_at,
  ];
  for (const candidate of candidates) {
    const timestamp = normalizeTimestamp(candidate);
    if (timestamp) {
      return timestamp;
    }
  }
  return null;
}

function requirePageData(response) {
  if (!response || typeof response !== "object" || !Array.isArray(response.data)) {
    throw schemaError("data", "must be an array for a paginated response");
  }
  return response.data;
}

function nextPagePath(response) {
  const candidate =
    response?.links?.next?.href ??
    response?.links?.next ??
    response?.meta?.pagination?.next ??
    null;
  if (!candidate) {
    return null;
  }
  if (typeof candidate !== "string") {
    throw schemaError("links.next", "must be a URL string or null");
  }
  return assertReadOnlyPath(candidate);
}

function withPage(path, pageNumber, pageSize) {
  const url = new URL(assertReadOnlyPath(path), "https://apiv2.sarwa.co");
  url.searchParams.set("page[number]", String(pageNumber));
  url.searchParams.set("page[size]", String(pageSize));
  return `${url.pathname}${url.search}`;
}

function pageFingerprint(data) {
  return JSON.stringify(
    data.map((item) => item?.id ?? item?.attributes?.id ?? item).slice(0, 8),
  );
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function newestTimestamp(left, right) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function invalidCursor() {
  return new SarwaError(
    "INVALID_CURSOR",
    "The cursor is invalid for this read-only resource.",
    { retryable: false },
  );
}
