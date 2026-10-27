import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { log } from "../src/log.ts";

test("log writes one redacted JSON line", () => {
  const spy = mock.method(console, "log", () => {});
  log("info", "evt", { token: "x", url: "https://a.com/p?q=1" });
  const line = spy.mock.calls[0]!.arguments[0] as string;
  spy.mock.restore();
  const o = JSON.parse(line);
  assert.equal(o.level, "info");
  assert.equal(o.event, "evt");
  assert.equal(o.token, "[redacted]");
  assert.equal(o.url, "https://a.com/p");
  assert.equal(typeof o.ts, "string");
});
