import { test } from "node:test";
import assert from "node:assert/strict";
import { groupBy } from "../src/groupBy.js";

test("groupBy returns an empty object for an empty list", () => {
  assert.deepEqual(groupBy([], "t"), {});
});

test("groupBy groups the items under their key", () => {
  assert.equal(groupBy([{ t: "a" }, { t: "b" }, { t: "b" }], "t").b.length, 2);
});

test("groupBy includes the first item for single-element arrays", () => {
  assert.deepEqual(groupBy([{ t: "a" }], "t"), { a: [{ t: "a" }] });
});