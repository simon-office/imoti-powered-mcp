import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk } from "../src/chunk.mjs";

test("splits an even list into chunks", () => {
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});

test("returns an empty list for no items", () => {
  assert.deepEqual(chunk([], 3), []);
});

test("rejects a size below 1", () => {
  assert.throws(() => chunk([1], 0), RangeError);
});