import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { saveFixture } from "../scripts/phase0/lib.ts";

test("saveFixture replaces every secret", () => {
  const path = saveFixture("tmp/x.json", '{"k":"abc","u":"x?api_key=abc"}', ["abc"]);
  try {
    const text = readFileSync(path, "utf8");
    assert.ok(!text.includes("abc"));
    assert.equal(text, '{"k":"REDACTED","u":"x?api_key=REDACTED"}');
  } finally {
    rmSync(dirname(path), { recursive: true, force: true });
  }
});
