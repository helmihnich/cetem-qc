import assert from "node:assert/strict";
import test from "node:test";
import { checkPasswordRules, isPasswordCompliant } from "./password-policy.js";

test("accepts an 8-character password with uppercase, lowercase, digit and special character", () => {
  assert.equal(isPasswordCompliant("Abcdef1!"), true);
});

test("reports each missing requirement", () => {
  assert.deepEqual(checkPasswordRules("abc"), { length: false, uppercase: false, lowercase: true, digit: false, special: false });
  assert.equal(isPasswordCompliant("Abcdefg1"), false);
  assert.equal(isPasswordCompliant("abcdef1!"), false);
  assert.equal(isPasswordCompliant("ABCDEF1!"), false);
  assert.equal(isPasswordCompliant("Abcdefg!"), false);
  assert.equal(isPasswordCompliant("Abc1!"), false);
});
