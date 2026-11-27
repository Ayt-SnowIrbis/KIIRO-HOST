import assert from "node:assert/strict";
import test from "node:test";
import { signConsoleOpen } from "../apps/api/src/modules/compute/console-bridge";
import { verifyConsoleOpen } from "../apps/worker/src/incus-console-broker";
const key = "very-long-test-secret-which-is-not-a-real-production-secret-123456";
const request = {
  sid: "a".repeat(32),
  instanceId: "cmwzghsa6002low01xzje89l5",
  nodeId: "incus-test-node-01",
  externalName: "kh-cmwzghsa6002low01xzje89l5",
  issuedAt: Date.now(),
};
test("API signature authorizes only exact scoped worker target", () => {
  const signature = signConsoleOpen(request, key);
  assert.equal(verifyConsoleOpen({ ...request, signature }, request.nodeId, key), true);
  assert.equal(verifyConsoleOpen({ ...request, signature, externalName: "kh-different" }, request.nodeId, key), false);
  assert.equal(verifyConsoleOpen({ ...request, signature, instanceId: "other" }, request.nodeId, key), false);
  assert.equal(verifyConsoleOpen({ ...request, signature }, "other-node", key), false);
  assert.equal(verifyConsoleOpen({ ...request, signature, issuedAt: request.issuedAt - 20000 }, request.nodeId, key), false);
  assert.equal(verifyConsoleOpen({ ...request, signature: "a".repeat(64) }, request.nodeId, key), false);
});
