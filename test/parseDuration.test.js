import test from "node:test";
import assert from "node:assert/strict";
import { parseDuration } from "../src/parseDuration.js";

test("parseDuration returns seconds for seconds input", () => {
  assert.equal(parseDuration("45s"), 45);
});

test("parseDuration returns seconds for minutes input", () => {
  assert.equal(parseDuration("2m"), 120);
});

test("parseDuration returns seconds for hours and minutes combined", () => {
  assert.equal(parseDuration("1h30m"), 5400);
});

test("parseDuration allows space between parts", () => {
  assert.equal(parseDuration("1h 30m"), 5400);
});

test("parseDuration returns 0 for zero seconds", () => {
  assert.equal(parseDuration("0s"), 0);
});

test("parseDuration throws RangeError for empty string", () => {
  assert.throws(() => parseDuration(""), RangeError);
});

test("parseDuration throws RangeError for unknown unit", () => {
  assert.throws(() => parseDuration("5x"), RangeError);
});