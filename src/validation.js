import { SarwaError } from "./errors.js";

export function asDate(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isNaN(Date.parse(value))
  ) {
    throw new SarwaError(
      "USAGE",
      `Invalid date: ${value}. Use YYYY-MM-DD or ISO 8601.`,
      { retryable: false },
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const normalized = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(normalized.getTime()) ||
      normalized.toISOString().slice(0, 10) !== value
    ) {
      throw new SarwaError("USAGE", `Invalid calendar date: ${value}.`, {
        retryable: false,
      });
    }
  }
  return value;
}

export function isDateInput(value) {
  try {
    asDate(value);
    return true;
  } catch {
    return false;
  }
}
