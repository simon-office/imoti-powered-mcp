import { test } from "node:test";
import assert from "node:assert/strict";
import { average } from "../src/average.mjs";

test("averages two values", () => {
  assert.equal(average([0, 4]), 2);
});

test("rejects an empty list", () => {
  assert.throws(() => average([]), RangeError);
});