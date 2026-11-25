import { test } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { generateRootCredential } from "../apps/api/src/modules/compute/ssh-password";

test("generated password has high entropy and a valid SHA512 crypt hash", () => {
  const first = generateRootCredential();
  const second = generateRootCredential();
  assert.match(first.password, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(first.password, second.password);
  assert.notEqual(first.hash, second.hash);
  assert.ok(!first.hash.includes(first.password));
  assert.match(first.hash, /^\$6\$[A-Za-z0-9./]{1,16}\$[A-Za-z0-9./]{86}$/);
  const salt = first.hash.split("$")[2];
  const expected = execFileSync("openssl", ["passwd", "-6", "-salt", salt, "-stdin"], {
    input: first.password + "\n", encoding: "utf8",
  }).trim();
  assert.equal(expected, first.hash);
  const wrong = execFileSync("openssl", ["passwd", "-6", "-salt", salt, "-stdin"], {
    input: second.password + "\n", encoding: "utf8",
  }).trim();
  assert.notEqual(wrong, first.hash);
});
