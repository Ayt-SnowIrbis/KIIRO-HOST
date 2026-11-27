import assert from "node:assert/strict";
import test from "node:test";
import { validConsoleUpgrade } from "../apps/api/src/modules/compute/console-websocket";

const previous = {
  flag: process.env.CONSOLE_WS_ENABLED,
  origins: process.env.CONSOLE_ALLOWED_ORIGINS,
};
const valid = {
  url: "/api/console/ws",
  headers: {
    origin: "https://hosting.kiirocoin.org",
    cookie: "kiiro_session=" + "a".repeat(43),
    "sec-fetch-site": "same-origin",
  },
};
test("disabled by default regardless of headers", () => {
  delete process.env.CONSOLE_WS_ENABLED;
  process.env.CONSOLE_ALLOWED_ORIGINS = "https://hosting.kiirocoin.org";
  assert.equal(validConsoleUpgrade(valid), false);
});
test("requires explicit production HTTPS origin and exact path", () => {
  process.env.CONSOLE_WS_ENABLED = "true";
  process.env.CONSOLE_ALLOWED_ORIGINS = "https://hosting.kiirocoin.org";
  assert.equal(validConsoleUpgrade(valid), true);
  assert.equal(validConsoleUpgrade({ ...valid, url: "/api/console/ws?ticket=secret" }), false);
  assert.equal(validConsoleUpgrade({ ...valid, headers: { ...valid.headers, origin: "https://evil.example" } }), false);
  assert.equal(validConsoleUpgrade({ ...valid, headers: { ...valid.headers, "sec-fetch-site": "cross-site" } }), false);
  assert.equal(validConsoleUpgrade({ ...valid, headers: { ...valid.headers, "sec-websocket-protocol": "ticket" } }), false);
  assert.equal(validConsoleUpgrade({ ...valid, headers: { ...valid.headers, cookie: "" } }), false);
  process.env.CONSOLE_ALLOWED_ORIGINS = "http://hosting.kiirocoin.org";
  assert.equal(validConsoleUpgrade(valid), false);
});
test.after(() => {
  if (previous.flag === undefined) delete process.env.CONSOLE_WS_ENABLED;
  else process.env.CONSOLE_WS_ENABLED = previous.flag;
  if (previous.origins === undefined) delete process.env.CONSOLE_ALLOWED_ORIGINS;
  else process.env.CONSOLE_ALLOWED_ORIGINS = previous.origins;
});
