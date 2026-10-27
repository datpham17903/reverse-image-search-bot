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

test("saveFixture redacts signed discord query params in plain, encoded and html forms", () => {
  const plain = "https://cdn.discordapp.com/a/b.png?ex=68aa1b2c&is=68a8c9ac&hm=0f1e2d3c&width=100";
  const encoded = "https%3A%2F%2Fcdn.discordapp.com%2Fa%2Fb.png%3Fex%3D68aa1b2c%26is%3D68a8c9ac%26hm%3D0f1e2d3c";
  const html = "https://cdn.discordapp.com/a/b.png?ex=68aa1b2c&amp;is=68a8c9ac&amp;hm=0f1e2d3c";
  const path = saveFixture("tmp/y.txt", [plain, encoded, html].join("\n"), []);
  try {
    const text = readFileSync(path, "utf8");
    for (const v of ["68aa1b2c", "68a8c9ac", "0f1e2d3c"]) assert.ok(!text.includes(v), v);
    assert.ok(text.includes("width=100"));
    assert.ok(text.includes("?ex=REDACTED&is=REDACTED&hm=REDACTED"));
    assert.ok(text.includes("%3Fex%3DREDACTED%26is%3DREDACTED%26hm%3DREDACTED"));
    assert.ok(text.includes("?ex=REDACTED&amp;is=REDACTED&amp;hm=REDACTED"));
  } finally {
    rmSync(dirname(path), { recursive: true, force: true });
  }
});
