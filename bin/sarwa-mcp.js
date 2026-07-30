#!/usr/bin/env node

import process from "node:process";

import { runMcpServer } from "../src/mcp.js";
import { normalizeError } from "../src/errors.js";
import { sanitizeTerminalText } from "../src/output.js";

runMcpServer().catch((error) => {
  const normalized = normalizeError(error);
  process.stderr.write(
    `sarwa-mcp: ${sanitizeTerminalText(normalized.message)}\n`,
  );
  process.exitCode = normalized.exitCode;
});
