import { test } from "node:test";
import assert from "node:assert/strict";
import { keyBy } from "../src/keyBy.js";

test("keyBy returns an empty object for an empty list", () => {
  assert.deepEqual(keyBy([], "t"), {});
});

test("keyBy maps each key to its first item", () => {
  assert.equal(keyBy([{ t: "a", n: 1 }, { t: "b", n: 2 }, { t: "b", n: 3 }], "t").b.n, 2);
});