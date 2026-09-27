import test from "node:test";
import assert from "node:assert/strict";
import { titleCase } from "../src/titleCase.js";

test("titleCase capitalizes first letter of each word", () => {
  assert.equal(titleCase("hello world"), "Hello World");
});

test("titleCase lowercases the rest of each word", () => {
  assert.equal(titleCase("hELLO wORLD"), "Hello World");
});

test("titleCase returns empty string for empty input", () => {
  assert.equal(titleCase(""), "");
});

test("titleCase handles single letters separated by spaces", () => {
  assert.equal(titleCase("a b"), "A B");
});

test("titleCase handles single word", () => {
  assert.equal(titleCase("hello"), "Hello");
});

test("titleCase handles mixed case single word", () => {
  assert.equal(titleCase("hELLO"), "Hello");
});