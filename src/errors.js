export class SarwaError extends Error {
  constructor(
    code,
    message,
    { cause, exitCode = 1, retryable = false } = {},
  ) {
    super(message, { cause });
    this.name = "SarwaError";
    this.code = code;
    this.exitCode = exitCode;
    this.retryable = retryable;
  }
}

export function authError(message, code = "AUTH_REQUIRED") {
  return new SarwaError(code, message, {
    exitCode: 2,
    retryable: false,
  });
}

export function cancellationError() {
  return new SarwaError(
    "CANCELLED",
    "The operation was cancelled.",
    { retryable: true },
  );
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw cancellationError();
  }
}

export function schemaError(field, detail = "has an unexpected value") {
  return new SarwaError(
    "UPSTREAM_SCHEMA_CHANGED",
    `Sarwa response field \`${field}\` ${detail}.`,
    { retryable: false },
  );
}

export function normalizeError(error) {
  if (error instanceof SarwaError) {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    error.code.startsWith("commander.")
  ) {
    return new SarwaError("USAGE", cleanCommanderMessage(error.message), {
      retryable: false,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new SarwaError("INTERNAL_ERROR", message || "Unexpected failure.", {
    cause: error instanceof Error ? error : undefined,
    retryable: false,
  });
}

function cleanCommanderMessage(message) {
  return String(message || "Invalid command.")
    .replace(/^error:\s*/i, "")
    .trim();
}
