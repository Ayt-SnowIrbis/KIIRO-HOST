import assert from "node:assert/strict";
import test from "node:test";
import { consoleClaimsMatchActor } from "../apps/api/src/modules/compute/console-authorization";
import { consoleAvailability } from "../apps/api/src/modules/compute/console-policy";

const claims = {
  sessionId: "session-a", userId: "user-a", role: "user" as const,
  instanceId: "instance-a", nodeId: "node-a", externalName: "kh-instance-a",
};
const actor = { sessionId: "session-a", userId: "user-a", role: "user" };
const target = {
  id: "instance-a", customerId: "customer-a", nodeId: "node-a",
  externalId: "kh-instance-a",
};
test("grants exact customer session, identity and ownership", () => {
  assert.equal(consoleClaimsMatchActor(claims, actor, target, "user-a"), true);
});
test("denies another user's session, role or mismatched customer", () => {
  assert.equal(consoleClaimsMatchActor(claims, { ...actor, userId: "user-b" }, target, "user-a"), false);
  assert.equal(consoleClaimsMatchActor(claims, { ...actor, sessionId: "session-b" }, target, "user-a"), false);
  assert.equal(consoleClaimsMatchActor(claims, { ...actor, role: "admin" }, target, "user-a"), false);
  assert.equal(consoleClaimsMatchActor(claims, actor, target, "user-b"), false);
  assert.equal(consoleClaimsMatchActor(claims, actor, target, null), false);
});
test("denies cross-node and forged instance identity", () => {
  assert.equal(consoleClaimsMatchActor(claims, actor, { ...target, id: "instance-b" }, "user-a"), false);
  assert.equal(consoleClaimsMatchActor(claims, actor, { ...target, nodeId: "node-b" }, "user-a"), false);
  assert.equal(consoleClaimsMatchActor(claims, actor, { ...target, externalId: "kh-other" }, "user-a"), false);
});
test("permits properly bound administrator irrespective of customer owner", () => {
  const admin = { sessionId: "session-admin", userId: "admin-a", role: "admin" };
  assert.equal(consoleClaimsMatchActor({ ...claims, role: "admin", userId: "admin-a", sessionId: "session-admin" }, admin, target, null), true);
});
const now = Date.parse("2026-11-28T00:00:00.000Z");
const instance = {
  kind: "CONTAINER", status: "RUNNING", deletedAt: null,
  externalId: "kh-instance-a", metadata: { mode: "REAL", provisioning: "INCUS" },
  provider: { slug: "INCUS" },
  node: { status: "ONLINE", lastSeenAt: new Date(now - 1000), metadata: { mode: "REAL" } },
};
test("console availability denies unsafe guest and node states", () => {
  assert.equal(consoleAvailability(instance, false, now).available, true);
  assert.equal(consoleAvailability(instance, true, now).available, false);
  assert.equal(consoleAvailability({ ...instance, status: "STOPPED" }, false, now).available, false);
  assert.equal(consoleAvailability({ ...instance, deletedAt: new Date(now) }, false, now).available, false);
  assert.equal(consoleAvailability({ ...instance, externalId: "not-managed" }, false, now).available, false);
  assert.equal(consoleAvailability({ ...instance, node: { ...instance.node, status: "OFFLINE" } }, false, now).available, false);
  assert.equal(consoleAvailability({ ...instance, node: { ...instance.node, lastSeenAt: new Date(now - 181000) } }, false, now).available, false);
});
