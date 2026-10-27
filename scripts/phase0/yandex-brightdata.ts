import { imageUrlArg, requireEnv, saveFixture } from "./lib.ts";

const { BRIGHTDATA_API_KEY, BRIGHTDATA_ZONE } = requireEnv(["BRIGHTDATA_API_KEY", "BRIGHTDATA_ZONE"]);
const url = imageUrlArg();

const res = await fetch("https://api.brightdata.com/request", {
  method: "POST",
  headers: { authorization: `Bearer ${BRIGHTDATA_API_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({
    zone: BRIGHTDATA_ZONE,
    url: `https://yandex.com/images/search?rpt=imageview&cbir_page=sites&url=${encodeURIComponent(url)}`,
    format: "raw",
  }),
});
const text = await res.text();
saveFixture("yandex/brightdata-sites.html", text, [BRIGHTDATA_API_KEY]);
console.log(`status=${res.status} length=${text.length} captcha=${/showcaptcha|SmartCaptcha/i.test(text)}`);
