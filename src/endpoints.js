import { READ_ENDPOINTS } from "./constants.js";

function accountPath(template, accountId) {
  if (!accountId) {
    throw new Error("This command requires --account <id>.");
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
    throw new Error("Invalid account id.");
  }
  return template.replace("{account_id}", encodeURIComponent(accountId));
}

export function resolveEndpoint(name, { account } = {}) {
  const endpoint = READ_ENDPOINTS[name];
  if (!endpoint) {
    throw new Error(`Unknown read endpoint: ${name}`);
  }
  if (account && endpoint.accountPath) {
    return accountPath(endpoint.accountPath, account);
  }
  if (endpoint.path) {
    return endpoint.path;
  }
  return accountPath(endpoint.accountPath, account);
}

export function endpointNeedsAccount(name) {
  return Boolean(READ_ENDPOINTS[name]?.accountPath);
}

export function listBuiltInEndpoints() {
  return Object.entries(READ_ENDPOINTS).map(([name, endpoint]) => ({
    command: name === "marketClock" ? "market-clock" : name,
    description: endpoint.description,
    path: endpoint.path || endpoint.accountPath,
  }));
}
