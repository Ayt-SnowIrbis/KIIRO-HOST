import test from "node:test";
import assert from "node:assert/strict";
import {
  assertManagedConsoleName, consoleDimensions, incusResizeControl, parseConsoleStreams,
} from "../apps/worker/src/incus-console-protocol";

const operation = "/1.0/operations/67e113a3-d443-4e7d-82be-bc41104cc5c8";
const fds = { "0": "a".repeat(64), control: "b".repeat(64) };

test("accepts a strict Incus PTY response", () => {
  const parsed = parseConsoleStreams(operation, { metadata: { fds } });
  assert.equal(parsed.operationPath, operation);
  assert.equal(parsed.terminalSecret, fds["0"]);
  assert.equal(parsed.controlSecret, fds.control);
});
test("rejects remote or forged operation path", () => {
  for (const candidate of [
    "https://attacker.invalid" + operation,
    operation + "?secret=bad", "/1.0/operations/../instances", "/1.0/operations/not-uuid",
  ]) assert.throws(() => parseConsoleStreams(candidate, { metadata: { fds } }));
});
test("fails closed when fds are missing or secrets malformed", () => {
  for (const metadata of [
    {}, { metadata: {} }, { metadata: { fds: { "0": "abc", control: "b".repeat(64) } } },
    { metadata: { fds: { "0": "a".repeat(64), control: "bad&secret" } } },
  ]) assert.throws(() => parseConsoleStreams(operation, metadata));
});
test("restricts console targets to owned Incus naming convention", () => {
  assert.doesNotThrow(() => assertManagedConsoleName("kh-cmwzghsa6002low01xzje89l5"));
  for (const name of ["localhost", "../../var", "kh-OK", "kh-" + "a".repeat(90)]) {
    assert.throws(() => assertManagedConsoleName(name));
  }
});
test("limits PTY dimensions and encodes Incus resize control", () => {
  assert.deepEqual(consoleDimensions(80, 24), { width: 80, height: 24 });
  assert.deepEqual(JSON.parse(incusResizeControl(100, 40)), {
    command: "window-resize", args: { width: "100", height: "40" },
  });
  for (const [w,h] of [[0,24],[400,24],[80,0],[80,200],[1.5,24]]) {
    assert.throws(() => incusResizeControl(w,h));
  }
});
