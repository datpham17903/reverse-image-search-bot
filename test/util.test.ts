import { test } from "node:test";
import assert from "node:assert/strict";
import { vnDayKey, utcDaysLeftInMonth, formatTimestamp } from "../src/util/time.ts";
import { newCode } from "../src/util/code.ts";
import { isDiscordImageUrl, signedUrlExpiresAt } from "../src/util/discord-url.ts";
import { redact } from "../src/log.ts";

test("vnDayKey rolls over at 17:00 UTC", () => {
  assert.equal(vnDayKey(Date.UTC(2026, 9, 27, 16, 59)), "2026-10-27");
  assert.equal(vnDayKey(Date.UTC(2026, 9, 27, 17, 0)), "2026-10-28");
});
test("utcDaysLeftInMonth counts today", () => {
  assert.equal(utcDaysLeftInMonth(Date.UTC(2026, 9, 1)), 31);
  assert.equal(utcDaysLeftInMonth(Date.UTC(2026, 9, 31, 23)), 1);
});
test("formatTimestamp", () => {
  assert.equal(formatTimestamp(754.6), "12:34");
  assert.equal(formatTimestamp(3725), "1:02:05");
});
test("newCode", () => assert.match(newCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/));
test("isDiscordImageUrl allows only https Discord hosts", () => {
  assert.ok(isDiscordImageUrl("https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2&hm=3"));
  assert.ok(isDiscordImageUrl("https://media.discordapp.net/external/abc/https/x.com/a.png"));
  assert.ok(isDiscordImageUrl("https://images-ext-1.discordapp.net/external/abc/https/x.com/a.png"));
  assert.ok(!isDiscordImageUrl("https://images-ext-1.discordapp.net.evil.com/a.png"));
  assert.ok(!isDiscordImageUrl("https://images-ext-x.discordapp.net/a.png"));
  assert.ok(!isDiscordImageUrl("http://cdn.discordapp.com/a.png"));
  assert.ok(!isDiscordImageUrl("https://cdn.discordapp.com.evil.com/a.png"));
  assert.ok(!isDiscordImageUrl("https://169.254.169.254/latest/meta-data"));
});
test("signedUrlExpiresAt parses hex ex", () => {
  assert.equal(signedUrlExpiresAt("https://cdn.discordapp.com/a.png?ex=6720f0a0&is=1&hm=2"), 0x6720f0a0 * 1000);
  assert.equal(signedUrlExpiresAt("https://cdn.discordapp.com/a.png"), null);
});
test("redact hides secrets and URL queries", () => {
  assert.deepEqual(
    redact({ apiKey: "k", token: "t", imageUrl: "https://cdn.discordapp.com/a.png?ex=1&hm=2", nested: { authorization: "Bearer x" }, n: 3 }),
    { apiKey: "[redacted]", token: "[redacted]", imageUrl: "https://cdn.discordapp.com/a.png", nested: { authorization: "[redacted]" }, n: 3 });
});
