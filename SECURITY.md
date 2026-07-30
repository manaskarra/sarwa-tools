# Security

Report vulnerabilities privately through GitHub Security Advisories. Do not
include credentials, cookies, tokens, account identifiers, or portfolio data in
public issues.

Only the latest release is supported. This project is unofficial and read-only;
Sarwa's internal API remains outside this project's control.

The MCP server uses local stdio and does not listen on a network port. Any MCP
host allowed to launch it can read the authenticated user's portfolio and
modify the private local agent watchlist, so configure it only in trusted hosts.
