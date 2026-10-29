export type EngineId = "tracemoe" | "saucenao" | "danbooru" | "yandex";
export type ProviderId = "tracemoe" | "saucenao" | "danbooru" | "iqdb" | "yandex_direct" | "brightdata" | "serpapi";
export type Mode = "auto" | "anime" | "art" | "movie";
export type Tier = "source" | "maybe" | "related";
export type CallPurpose = "primary" | "anime_followup" | "unknown_check" | "extra";
export type EngineStatus = "ok" | "no_match" | "quota_exhausted" | "rate_limited" | "timeout" | "invalid_input" | "unavailable";
export type OutcomeStatus = EngineStatus | "busy" | "server_quota" | "user_quota" | "deadline";
export interface Match {
  engine: EngineId; title: string; url: string; detail?: string; score?: number;
  previewUrl?: string; videoUrl?: string; adult: boolean | null; rating?: "g" | "s" | "q" | "e";
  isAnime?: boolean; hasEpisodeAndTime?: boolean; domain?: string;
}
export interface ImageSource { url: string; sha256: string; jpeg(): Promise<Buffer> }
export interface EngineInput { image: ImageSource; mode: Mode; nsfwChannel: boolean; signal: AbortSignal }
export interface EngineResponse {
  status: EngineStatus; matches: Match[]; sent: boolean; parseFailed?: boolean;
  quota?: { shortRemaining?: number; longRemaining?: number };
}
export interface Engine {
  id: EngineId; providers: readonly ProviderId[]; version: number;
  cacheParams(o: { mode: Mode; nsfwChannel: boolean }): string;
  search(input: EngineInput, provider: ProviderId): Promise<EngineResponse>; // không bao giờ throw
}
export interface EngineOutcome { engine: EngineId; status: OutcomeStatus; matches: Match[]; via?: ProviderId; fromCache?: boolean }
export interface TieredMatch extends Match { tier: Tier }
export const ENGINE_LABEL: Record<EngineId, string> = { tracemoe: "trace.moe", saucenao: "SauceNAO", danbooru: "Danbooru", yandex: "Yandex" };
