import test from "node:test";
import assert from "node:assert/strict";
import { clamp } from "../src/clamp.js";

test("clamp returns min when value is below minimum", () => {
  assert.equal(clamp(5, 10, 20), 10);
});

test("clamp returns max when value is above maximum", () => {
  assert.equal(clamp(25, 10, 20), 20);
});

test("clamp returns value unchanged when within inclusive range", () => {
  assert.equal(clamp(15, 10, 20), 15);
});

test("clamp preserves exact min boundary", () => {
  assert.equal(clamp(10, 10, 20), 10);
});

test("clamp preserves exact max boundary", () => {
  assert.equal(clamp(20, 10, 20), 20);
});

test("clamp works with negative numbers", () => {
  assert.equal(clamp(-5, -10, 0), -5);
  assert.equal(clamp(-15, -10, 0), -10);
  assert.equal(clamp(5, -10, 0), 0);
});

test("clamp works with floats", () => {
  assert.equal(clamp(1.5, 1, 2), 1.5);
  assert.equal(clamp(0.5, 1, 2), 1);
  assert.equal(clamp(2.5, 1, 2), 2);
});