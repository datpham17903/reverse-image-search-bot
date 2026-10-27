import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS } from "../src/discord/commands.ts";

test("commands match the spec", () => {
  const search = COMMANDS.find(c => c.name === "search")!;
  assert.deepEqual(search.options!.find(o => o.name === "image"), { name: "image", type: 11, description: "Chọn ảnh cần tìm nguồn", required: true, file_types: ["image"] });
  assert.equal(COMMANDS.find(c => c.name === "quota")!.default_member_permissions, "32");
  assert.ok(COMMANDS.some(c => c.name === "Tìm nguồn ảnh" && c.type === 3));
});
