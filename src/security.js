import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SENSITIVE_KEY =
  /(^|_)(access_?token|refresh_?token|authorization|cookie|password|passcode|secret|otp|pin|ssn|passport|emirates_?id|date_?of_?birth|dob|email|phone|mobile|address|iban|bank_?account|account_?number|card_?number|cvv|cvc|client_?full_?name|full_?name|first_?name|last_?name|username)($|_)/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_ID = /^\d{6,}$/;
const ACTION_PATH_SEGMENT =
  /(^|\/)(auth|authz|login|logout|register|password|cancel|create|delete|place-order|withdrawals?|deposits?|transfers?|sign|submit|update|set|initiate|close|exercise|apply|confirm|verify|resend|reset|token-exchange|request-rebalancing)(\/|$)/i;

export function isSarwaApiUrl(value, additionalHosts = []) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    host === "sarwa.co" ||
    host.endsWith(".sarwa.co") ||
    additionalHosts.map((item) => item.toLowerCase()).includes(host)
  );
}

export function assertReadOnlyPath(value) {
  let url;
  try {
    url = new URL(value, "https://apiv2.sarwa.co");
  } catch {
    throw new Error("Invalid API path.");
  }
  if (url.origin !== "https://apiv2.sarwa.co") {
    throw new Error("Raw requests are restricted to https://apiv2.sarwa.co.");
  }
  if (!url.pathname.startsWith("/api/")) {
    throw new Error("Raw requests must use a /api/ path.");
  }
  if (ACTION_PATH_SEGMENT.test(url.pathname)) {
    throw new Error("That API path is blocked because it may perform an action.");
  }
  return `${url.pathname}${url.search}`;
}

export function redact(value, key = "", depth = 0) {
  if (depth > 12) {
    return "[MAX_DEPTH]";
  }
  if (SENSITIVE_KEY.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, key, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redact(childValue, childKey, depth + 1),
      ]),
    );
  }
  return value;
}

export function structuralSample(value, key = "", depth = 0) {
  if (depth > 12) {
    return "[MAX_DEPTH]";
  }
  if (SENSITIVE_KEY.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [structuralSample(value[0], key, depth + 1)];
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        structuralSample(childValue, childKey, depth + 1),
      ]),
    );
  }
  if (typeof value === "string") {
    return "<string>";
  }
  if (typeof value === "number") {
    return 0;
  }
  if (typeof value === "boolean") {
    return false;
  }
  return null;
}

export function schemaOf(value, depth = 0) {
  if (depth > 12) {
    return { type: "unknown" };
  }
  if (value === null) {
    return { type: "null" };
  }
  if (Array.isArray(value)) {
    return {
      items: value.length > 0 ? schemaOf(value[0], depth + 1) : {},
      type: "array",
    };
  }
  if (typeof value === "object") {
    return {
      properties: Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, schemaOf(child, depth + 1)]),
      ),
      type: "object",
    };
  }
  return { type: typeof value };
}

export function normalizeCapturedUrl(value) {
  const url = new URL(value);
  url.search = "";
  const segments = url.pathname.split("/").map((segment) => {
    if (UUID.test(segment)) {
      return "{uuid}";
    }
    if (LONG_ID.test(segment)) {
      return "{id}";
    }
    return segment;
  });
  url.pathname = segments.join("/");
  return url.toString();
}

export function resourceId(method, url) {
  return createHash("sha256")
    .update(`${method.toUpperCase()} ${normalizeCapturedUrl(url)}`)
    .digest("hex")
    .slice(0, 12);
}

export function createLocalApiToken() {
  return randomBytes(32).toString("base64url");
}

export function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
