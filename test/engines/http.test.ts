import { test } from "node:test";
import assert from "node:assert/strict";
import { PreSendError, sendRequest, isAbortError } from "../../src/engines/http.ts";

const netErr = (code: string) => new TypeError("fetch failed", { cause: { code } });

test("non-retryable error is not retried and is preserved", async () => {
  let n = 0;
  const boom = new Error("boom");
  const f = (async () => { n++; throw boom; }) as unknown as typeof fetch;
  await assert.rejects(sendRequest(f, "u", {}), (e) => e === boom);
  assert.equal(n, 1);
});

test("succeeds on second attempt", async () => {
  let n = 0;
  const f = (async () => { if (++n === 1) throw netErr("ECONNREFUSED"); return new Response("ok"); }) as unknown as typeof fetch;
  const res = await sendRequest(f, "u", {});
  assert.equal(await res.text(), "ok");
  assert.equal(n, 2);
});

test("ENOTFOUND and EAI_AGAIN are retried then PreSendError", async () => {
  for (const code of ["ENOTFOUND", "EAI_AGAIN"]) {
    let n = 0;
    const f = (async () => { n++; throw netErr(code); }) as unknown as typeof fetch;
    await assert.rejects(sendRequest(f, "u", {}), PreSendError);
    assert.equal(n, 2);
  }
});

test("isAbortError", () => {
  assert.equal(isAbortError(new DOMException("x", "AbortError")), true);
  assert.equal(isAbortError(new DOMException("x", "TimeoutError")), true);
  assert.equal(isAbortError(new Error("x")), false);
  const c = new AbortController(); c.abort();
  assert.equal(isAbortError(new Error("x"), c.signal), true);
});
