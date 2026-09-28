import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvLine } from "../src/parseCsvLine.js";

test("parseCsvLine splits simple CSV line", () => {
  assert.deepEqual(parseCsvLine("a,b,c"), ["a", "b", "c"]);
});

test("parseCsvLine keeps empty fields", () => {
  assert.deepEqual(parseCsvLine("a,,c"), ["a", "", "c"]);
  assert.deepEqual(parseCsvLine("a,"), ["a", ""]);
});

test("parseCsvLine returns single empty field for empty string", () => {
  assert.deepEqual(parseCsvLine(""), [""]);
});

test("parseCsvLine handles quoted field with commas", () => {
  assert.deepEqual(parseCsvLine('"a,b",c'), ["a,b", "c"]);
});

test("parseCsvLine handles escaped quotes in quoted field", () => {
  assert.deepEqual(parseCsvLine('"say ""hi""",x'), ['say "hi"', "x"]);
});

test("parseCsvLine preserves spaces as part of field", () => {
  assert.deepEqual(parseCsvLine(" a , b "), [" a ", " b "]);
});

test("parseCsvLine throws SyntaxError for quote not starting field", () => {
  assert.throws(
    () => parseCsvLine('a"b,c'),
    (err) => err instanceof SyntaxError && err.message.includes("column 2")
  );
});

test("parseCsvLine throws SyntaxError for unclosed quoted field", () => {
  assert.throws(
    () => parseCsvLine('a,"b'),
    (err) => err instanceof SyntaxError && err.message.includes("column 3")
  );
});

test("parseCsvLine throws SyntaxError for non-comma after closing quote", () => {
  assert.throws(
    () => parseCsvLine('"a"b'),
    (err) => err instanceof SyntaxError && err.message.includes("column 4")
  );
});

test("parseCsvLine throws TypeError for non-string argument", () => {
  assert.throws(
    () => parseCsvLine(123),
    (err) => err instanceof TypeError
  );
  assert.throws(
    () => parseCsvLine(null),
    (err) => err instanceof TypeError
  );
  assert.throws(
    () => parseCsvLine(undefined),
    (err) => err instanceof TypeError
  );
  assert.throws(
    () => parseCsvLine({}),
    (err) => err instanceof TypeError
  );
});