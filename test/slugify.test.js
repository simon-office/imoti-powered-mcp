import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slugify.js";

test("slugify trims, lowercases, and collapses spaces/punctuation", () => {
  assert.equal(slugify("  Hello, World!  "), "hello-world");
});

test("slugify returns empty string for empty input", () => {
  assert.equal(slugify(""), "");
});

test("slugify collapses runs of punctuation and spaces into a single dash", () => {
  assert.equal(slugify("Hello,   World!"), "hello-world");
  assert.equal(slugify("a---b c"), "a-b-c");
});

test("slugify lowercases and strips leading/trailing dashes", () => {
  assert.equal(slugify("  --Foo Bar--  "), "foo-bar");
});

test("slugify preserves digits and splits them with punctuation", () => {
  assert.equal(slugify("Version 2.0!"), "version-2-0");
});