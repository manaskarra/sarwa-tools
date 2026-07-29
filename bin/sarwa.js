#!/usr/bin/env node

import { handleCliError, run } from "../src/cli.js";

run(process.argv).catch((error) => {
  handleCliError(error, process.argv);
});
