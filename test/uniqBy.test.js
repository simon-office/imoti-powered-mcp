import { test } from "node:test";
import assert from "node:assert/strict";
import { uniqBy } from "../src/uniqBy.js";

test("uniqBy returns an empty list for an empty list", () => {
  assert.deepEqual(uniqBy([], "t"), []);
});

test("uniqBy keeps the first item for each key", () => {
  assert.equal(uniqBy([{ t: "a", n: 1 }, { t: "b", n: 2 }, { t: "b", n: 3 }], "t").find((x) => x.t === "b").n, 2);
});

test("uniqBy retains the first item when it is unique", () => {
  const result = uniqBy([{ t: "a", n: 1 }, { t: "b", n: 2 }], "t");
  assert.deepEqual(result, [{ t: "a", n: 1 }, { t: "b", n: 2 }]);
});