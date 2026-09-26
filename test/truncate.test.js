import test from "node:test";
import assert from "node:assert/strict";
import { truncate } from "../src/truncate.js";

test("truncate returns text unchanged when length is less than max", () => {
  assert.equal(truncate("hello", 10), "hello");
});

test("truncate returns text unchanged when length equals max", () => {
  assert.equal(truncate("hello", 5), "hello");
});

test("truncate returns ellipsis when text exceeds max", () => {
  assert.equal(truncate("hello world", 8), "hello w…");
});

test("truncate handles exact boundary at max - 1", () => {
  assert.equal(truncate("abcdef", 4), "abc…");
});

test("truncate returns ellipsis for max of 1", () => {
  assert.equal(truncate("hello", 1), "…");
});

test("truncate returns ellipsis for max of 0", () => {
  assert.equal(truncate("hello", 0), "…");
});

test("truncate handles empty string", () => {
  assert.equal(truncate("", 5), "");
});

test("truncate handles unicode characters", () => {
  assert.equal(truncate("héllo", 4), "hél…");
});