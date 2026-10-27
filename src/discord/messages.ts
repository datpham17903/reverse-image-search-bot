import type { Mode, OutcomeStatus, Tier } from "../engines/types.ts";
import type { ImageErrorCode } from "../images/download.ts";

export const TIER_LABEL: Record<Tier, string> = { source: "NGUỒN TÌM ĐƯỢC", maybe: "CÓ THỂ LÀ", related: "LIÊN QUAN" };

export const MODE_LABEL: Record<Mode, string> = {
  auto: "Tự động", anime: "Cảnh anime", art: "Art / tranh", movie: "Phim người đóng",
};

const REASONS: Record<string, string> = {
  server_quota: "hết lượt hôm nay của server",
  quota_exhausted: "hết lượt hôm nay của server",
  busy: "đang bận",
  rate_limited: "đang bận",
  user_quota: "bạn đã hết lượt Yandex hôm nay",
  deadline: "hết thời gian",
  timeout: "hết thời gian",
  unavailable: "lỗi",
  invalid_input: "lỗi",
};
export const reason = (s: OutcomeStatus): string => REASONS[s] ?? "lỗi";

export const msg = {
  searching: "ĐANG TÌM…",
  progressDone: (engines: string) => `Đã xong: ${engines}`,
  progressAsking: (engine: string) => `Đang hỏi: ${engine}`,
  progressMax: (s: number) => `Tối đa ${s} giây`,
  notFound: "CHƯA XÁC ĐỊNH ĐƯỢC NGUỒN",
  notFoundBody: (engines: string) => `Đã tìm bằng ${engines} nhưng không có kết quả đủ tin cậy.`,
  incomplete: "CHƯA TÌM HẾT",
  others: "Ứng viên khác",
  searchYourself: "Tự tìm tiếp:",
  footer: (engines: string, n: number, code: string) => `Đã tìm: ${engines} · Bạn còn ${n} lượt hôm nay · Mã: ${code}`,
  busy: "Bot đang bận, thử lại sau ít phút",
  restarting: "Bot đang khởi động lại, thử lại sau ít giây",
  cooldown: (n: number) => `Đợi ${n} giây nữa rồi thử lại`,
  dailyLimit: (n: number) => `Bạn đã dùng hết ${n} lượt hôm nay`,
  active: "Bạn đang có một lượt tìm chưa xong",
  imageDecode: "Không đọc được ảnh",
  imageTooLarge: (mb: number) => `Ảnh lớn hơn ${mb} MB`,
  imagePixels: (mp: number) => `Ảnh lớn hơn ${mp} triệu điểm ảnh`,
  imageFetch: "Không tải được ảnh, hãy gửi lại ảnh",
  imageUnsupported: "Định dạng ảnh chưa hỗ trợ",
  genericError: "Có lỗi khi tìm, thử lại sau",
  notOwner: "Chỉ người tìm mới dùng được nút này",
  sessionExpired: "Phiên đã hết, hãy tìm lại",
  noImage: "Tin nhắn này không có ảnh. Dùng /search và tải ảnh lên để tìm.",
  pickPrompt: (n: number) => `Tin nhắn này có ${n} ảnh. Chọn ảnh cần tìm nguồn:`,
  pickPlaceholder: "Chọn ảnh cần tìm nguồn",
  changeMode: "Đổi chế độ",
  moreYandex: "Tìm thêm bằng Yandex",
  yandexUnavailable: "Yandex hiện đã hết lượt",
  adminOnly: "Lệnh này chỉ dành cho admin",
  watchClip: "Xem đoạn cảnh",
  privacy: "Ảnh bạn tìm sẽ được gửi tới trace.moe, SauceNAO, Danbooru và Yandex (qua Bright Data hoặc SerpApi).",
} as const;

export const imageErrorText = (code: ImageErrorCode, mb: number, mp: number): string => {
  switch (code) {
    case "decode_failed": return msg.imageDecode;
    case "too_large": return msg.imageTooLarge(mb);
    case "too_many_pixels": return msg.imagePixels(mp);
    case "unsupported": return msg.imageUnsupported;
    case "fetch_failed":
    case "not_allowed": return msg.imageFetch;
  }
};
