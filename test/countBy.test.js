import { test } from "node:test";
import assert from "node:assert/strict";
import { countBy } from "../src/countBy.js";

test("countBy returns an empty object for an empty list", () => {
  assert.deepEqual(countBy([], "t"), {});
});

test("countBy counts the values under the key", () => {
  assert.equal(countBy([{ t: "a" }, { t: "b" }, { t: "b" }], "t").b, 2);
});

test("countBy counts the first item", () => {
  assert.equal(countBy([{ t: "a" }, { t: "b" }, { t: "b" }], "t").a, 1);
});