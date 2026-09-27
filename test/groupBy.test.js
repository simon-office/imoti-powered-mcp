import test from "node:test";
import assert from "node:assert/strict";
import { groupBy } from "../src/groupBy.js";

test("groupBy groups items by key", () => {
  const input = [{ t: "a", n: 1 }, { t: "b", n: 2 }, { t: "a", n: 3 }];
  const result = groupBy(input, "t");
  assert.deepEqual(result, {
    a: [{ t: "a", n: 1 }, { t: "a", n: 3 }],
    b: [{ t: "b", n: 2 }],
  });
});

test("groupBy returns empty object for empty array", () => {
  assert.deepEqual(groupBy([], "t"), {});
});

test("groupBy preserves input order inside each group", () => {
  const input = [
    { t: "a", n: 1 },
    { t: "b", n: 2 },
    { t: "a", n: 3 },
    { t: "b", n: 4 },
    { t: "a", n: 5 },
  ];
  const result = groupBy(input, "t");
  assert.deepEqual(result.a, [{ t: "a", n: 1 }, { t: "a", n: 3 }, { t: "a", n: 5 }]);
  assert.deepEqual(result.b, [{ t: "b", n: 2 }, { t: "b", n: 4 }]);
});

test("groupBy throws TypeError for non-array input", () => {
  assert.throws(() => groupBy("abc", "t"), TypeError);
});