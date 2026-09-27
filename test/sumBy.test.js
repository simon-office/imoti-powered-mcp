import { test } from "node:test";
import assert from "node:assert/strict";
import { sumBy } from "../src/sumBy.js";

test("sumBy returns 0 for an empty list", () => {
  assert.equal(sumBy([], "n"), 0);
});

test("sumBy adds the values under the key", () => {
  assert.equal(sumBy([{ n: 0 }, { n: 2 }, { n: 3 }], "n"), 5);
});

test("sumBy includes the first item (regression)", () => {
  assert.equal(sumBy([{ n: 1 }, { n: 2 }], "n"), 3);
});