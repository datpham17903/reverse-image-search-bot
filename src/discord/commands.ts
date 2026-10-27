import { REST, Routes } from "discord.js";
import type { Config } from "../config.ts";

interface CommandOption {
  name: string; type: number; description: string; required: boolean; file_types?: string[];
  choices?: { name: string; value: string }[];
}
interface Command { name: string; type: number; description?: string; options?: CommandOption[]; default_member_permissions?: string }

export const COMMANDS: Command[] = [
  { name: "search", type: 1, description: "Tìm nguồn ảnh anime, art hoặc phim", options: [
    { name: "image", type: 11, description: "Chọn ảnh cần tìm nguồn", required: true, file_types: ["image"] },
    { name: "mode", type: 3, description: "Chế độ tìm, mặc định tự động", required: false, choices: [
      { name: "Tự động", value: "auto" }, { name: "Cảnh anime", value: "anime" },
      { name: "Art / tranh", value: "art" }, { name: "Phim người đóng", value: "movie" } ] },
    { name: "private", type: 5, description: "Chỉ mình bạn thấy kết quả", required: false } ] },
  { name: "Tìm nguồn ảnh", type: 3 },
  { name: "quota", type: 1, description: "Xem quota còn lại của từng nguồn", default_member_permissions: "32" },
  { name: "help", type: 1, description: "Cách dùng bot tìm nguồn ảnh" },
];

export async function registerCommands(config: Config): Promise<void> {
  await new REST().setToken(config.discordToken)
    .put(Routes.applicationGuildCommands(config.discordApplicationId, config.discordGuildId), { body: COMMANDS });
}
