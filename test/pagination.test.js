import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeCursor,
  encodeCursor,
  fetchAllPages,
  fetchPage,
} from "../src/pagination.js";

test("pagination follows only fixed-origin read links and merges every page", async () => {
  const seen = [];
  const session = {
    get: async (path) => {
      seen.push(path);
      if (seen.length === 1) {
        return {
          data: [{ id: "one" }],
          links: { next: "/api/v1/items?page%5Bnumber%5D=2" },
        };
      }
      return { data: [{ id: "two" }], links: { next: null } };
    },
  };

  const result = await fetchAllPages(
    session,
    "/api/v1/items?page%5Bnumber%5D=1&page%5Bsize%5D=100",
  );
  assert.deepEqual(result.response.data, [{ id: "one" }, { id: "two" }]);
  assert.equal(result.partial, false);
  assert.equal(result.pages, 2);
});

test("single-page results expose an opaque validated cursor", async () => {
  const session = {
    get: async () => ({
      data: [{ id: "one" }],
      links: { next: "/api/v1/items?page%5Bnumber%5D=2" },
    }),
  };
  const result = await fetchPage(session, "/api/v1/items");

  assert.equal(decodeCursor(result.nextCursor), "/api/v1/items?page%5Bnumber%5D=2");
  assert.equal(encodeCursor(decodeCursor(result.nextCursor)), result.nextCursor);
  assert.throws(
    () =>
      decodeCursor(
        Buffer.from("https://evil.example/api/items", "utf8").toString(
          "base64url",
        ),
      ),
    (error) => error.code === "INVALID_CURSOR",
  );
});

test("repeated heuristic pages stop and are marked partial", async () => {
  const page = { data: [{ id: "same" }, { id: "same-2" }] };
  const session = { get: async () => page };
  const result = await fetchAllPages(session, "/api/v1/items", {
    pageSize: 2,
  });

  assert.equal(result.partial, true);
  assert.match(result.warnings[0], /repeated/i);
});
