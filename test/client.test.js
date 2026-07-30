import assert from "node:assert/strict";
import test from "node:test";

import { SarwaClient } from "../src/client.js";

test("snapshot resolves one account and returns one coherent agent document", async () => {
  const seen = [];
  const session = {
    get: async (requestPath) => {
      seen.push(requestPath);
      if (requestPath === "/api/account/list") {
        return [
          {
            external_account_id: "account-1",
            is_closed: false,
            product: "TRADE",
          },
        ];
      }
      if (requestPath.startsWith("/api/v1/positions/account-1")) {
        return {
          data: [
            {
              attributes: {
                asset_class: "us_equity",
                cost_basis: 50,
                current_price: 60,
                market_value: 60,
                qty: 1,
                symbol: "EXM",
                unrealized_pl: 10,
              },
            },
          ],
          links: { next: null },
        };
      }
      if (requestPath.startsWith("/api/v2/orders/account-1")) {
        return { data: [], links: { next: null } };
      }
      if (requestPath === "/api/v1/account-trading-details/account-1") {
        return {
          data: {
            attributes: {
              cash: 40,
              currency: "USD",
              earnings: 10,
              equity: 100,
              net_deposits: 90,
              returns: 0.1111,
            },
          },
        };
      }
      if (requestPath.startsWith("/api/v1/transactions/account-1")) {
        return {
          data: [
            {
              activity_type: "ORDER",
              date: "2026-07-30T00:00:00.000Z",
              number_of_shares: 1,
              price_per_share: 50,
              side: "buy",
              symbol: "EXM",
              total_value: 50,
            },
          ],
          links: { next: null },
        };
      }
      throw new Error(`Unexpected test path: ${requestPath}`);
    },
  };

  const result = await new SarwaClient({ session }).snapshot({
    transactionLimit: 20,
  });

  assert.equal(result.partial, false);
  assert.equal(result.snapshot.portfolio.value, 100);
  assert.equal(result.snapshot.holdings[0].symbol, "EXM");
  assert.equal(result.snapshot.transactions.length, 1);
  assert.deepEqual(result.snapshot.coverage, {
    transactions_complete: true,
    transactions_has_more: false,
  });
  assert.equal(
    seen.filter((requestPath) => requestPath === "/api/account/list").length,
    1,
  );
  assert.equal(seen.length, 5);
});
