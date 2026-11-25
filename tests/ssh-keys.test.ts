import { test } from "node:test";
import { strict as assert } from "node:assert";
import { checkedKey } from "../apps/api/src/modules/compute/ssh-keys";

const key="ssh-ed25519 "+Buffer.alloc(48,42).toString("base64")+" tester@example.com";
test("accepts a single SSH public key with a comment",()=>{
  assert.equal(checkedKey(key),key);
});
test("rejects command options, multiline keys, malformed formats and private key content",()=>{
  for(const invalid of [
    "command=\"id\" "+key,
    key+"\nssh-ed25519 "+Buffer.alloc(48,31).toString("base64"),
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "ssh-ed25519 AAAA; rm -rf /",
    "ssh-ed25519 "+Buffer.alloc(48,42).toString("base64")+" "+("x".repeat(81)),
    "",
  ]) {
    assert.throws(()=>checkedKey(invalid));
  }
});
