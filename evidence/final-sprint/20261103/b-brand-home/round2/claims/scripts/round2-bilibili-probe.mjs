// Round 2: Bilibili external link content verification (read-only GET only).
// Browser-like headers; if Bilibili anti-bot blocks (412/risk), record NOT_RUN with raw evidence.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(here, "..");
const rawDir = path.join(base, "raw");
const jsonDir = path.join(base, "json");
fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(jsonDir, { recursive: true });

const BV = "BV1Qaxb6PE7G";
const VIDEO_URL = `https://www.bilibili.com/video/${BV}?vd_source=eaf1b5590706fdf5d967f5f1d697db8b`;
const API_URL = `https://api.bilibili.com/x/web-interface/view?bvid=${BV}`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

async function probe(name, url, headers) {
  const startedAt = new Date().toISOString();
  const result = { name, url, headers, startedAt };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    clearTimeout(timer);
    const body = await res.text();
    const hdrs = {};
    for (const [k, v] of res.headers) hdrs[k] = v;
    result.status = res.status;
    result.ok = res.ok;
    result.finalUrl = res.url;
    result.contentType = hdrs["content-type"] ?? null;
    result.bodyBytes = Buffer.byteLength(body);
    result.bodySha256 = crypto.createHash("sha256").update(body, "utf8").digest("hex");
    result.capturedAtLocal = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") + "+08:00";
    result.headers = { ...headers, "x-response-server": hdrs["server"] ?? null, "x-response-bili-status": hdrs["bili-status-code"] ?? null };
    const rawName = `${name}-status${res.status}-${Date.now()}.raw.txt`;
    fs.writeFileSync(path.join(rawDir, rawName), body, "utf8");
    result.rawFile = `raw/${rawName}`;
    result.bodyPrefix = body.slice(0, 500);
    return result;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    result.ok = false;
    return result;
  }
}

const results = [];
results.push(await probe("bilibili-api-view", API_URL, {
  "user-agent": UA,
  accept: "application/json, text/plain, */*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  referer: VIDEO_URL,
  origin: "https://www.bilibili.com",
}));
results.push(await probe("bilibili-video-page", VIDEO_URL, {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  referer: "https://www.bilibili.com/",
}));

// Parse only when API returned usable JSON; never infer missing fields.
let parsed = null;
const api = results.find((r) => r.name === "bilibili-api-view");
if (api && api.status === 200 && api.rawFile) {
  try {
    const raw = fs.readFileSync(path.join(base, api.rawFile), "utf8");
    const body = JSON.parse(raw);
    if (body && body.code === 0 && body.data) {
      const d = body.data;
      parsed = {
        apiCode: body.code,
        apiMessage: body.message ?? null,
        bvid: d.bvid ?? null,
        aid: d.aid ?? null,
        cid: d.cid ?? null,
        title: d.title ?? null,
        owner: d.owner ? { mid: d.owner.mid ?? null, name: d.owner.name ?? null } : null,
        pages: Array.isArray(d.pages) ? d.pages.slice(0, 3).map((p) => ({ cid: p.cid ?? null, page: p.page ?? null, part: p.part ?? null, duration: p.duration ?? null, width: p.dimension?.width ?? null, height: p.dimension?.height ?? null })) : null,
        videos: typeof d.videos === "number" ? d.videos : null,
        durationSeconds: typeof d.duration === "number" ? d.duration : null,
        durationText: typeof d.duration === "number" ? `${Math.floor(d.duration / 60)}:${String(d.duration % 60).padStart(2, "0")}` : null,
        pubdate: typeof d.pubdate === "number" ? new Date(d.pubdate * 1000).toISOString() : null,
        pubdateEpoch: typeof d.pubdate === "number" ? d.pubdate : null,
        pubdateLocal: typeof d.pubdate === "number" ? new Date(d.pubdate * 1000).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") + "+08:00" : null,
        stat: d.stat ?? null,
        tname: d.tname ?? null,
        descSnippet: typeof d.desc === "string" ? d.desc.slice(0, 300) : null,
      };
    } else {
      parsed = { apiCode: body?.code ?? null, apiMessage: body?.message ?? null, usable: false };
    }
  } catch (err) {
    parsed = { parseError: String(err && err.message ? err.message : err) };
  }
}

// Page HTML: extract title / og:title if present (only from actual response).
let pageMeta = null;
const page = results.find((r) => r.name === "bilibili-video-page");
if (page && page.ok && page.rawFile) {
  const html = fs.readFileSync(path.join(base, page.rawFile), "utf8");
  const pick = (re) => {
    const m = html.match(re);
    return m ? (m[1] || m[2] || "").trim().slice(0, 300) : null;
  };
  pageMeta = {
    titleTag: pick(/<title[^>]*>([^<]{1,300})<\/title>/i),
    ogTitle: pick(/property=["']og:title["']\s+content=["']([^"']{1,300})["']/i) || pick(/content=["']([^"']{1,300})["']\s+property=["']og:title["']/i),
    ogDescription: pick(/property=["']og:description["']\s+content=["']([^"']{1,300})["']/i),
    hasRiskPageMarker: /验证码|访问异常|412|安全验证|risk/i.test(html.slice(0, 20000)),
  };
}

// Verdict: only report fields actually captured in this run.
const capturable = Boolean(parsed && parsed.apiCode === 0 && parsed.title);
const pageReachable = Boolean(page && page.ok && pageMeta && pageMeta.titleTag);
const verdict = capturable
  ? "CAPTURED"
  : pageReachable
    ? "PARTIAL_PAGE_ONLY"
    : "NOT_RUN";

// Lead-provided expectations (from user/task); compare only, do not infer.
const EXPECTED = {
  title: "2026 C4-AI 决赛演示视频 万卷siu 忆程ProjectMemo 演示视频",
  ownerName: "鲁昂萘尔",
  durationSeconds: 277,
  videos: 1,
  pubdateEpoch: 1793543090,
};
const norm = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : null);
const comparison = parsed
  ? {
      titleMatch: norm(parsed.title) === norm(EXPECTED.title),
      titleActual: parsed.title,
      ownerNameMatch: parsed.owner?.name === EXPECTED.ownerName,
      ownerNameActual: parsed.owner?.name ?? null,
      durationMatch: parsed.durationSeconds === EXPECTED.durationSeconds,
      durationActualSeconds: parsed.durationSeconds,
      videosMatch: parsed.videos === EXPECTED.videos,
      videosActual: parsed.videos,
      pubdateEpochMatch: parsed.pubdateEpoch === EXPECTED.pubdateEpoch,
      pubdateEpochActual: parsed.pubdateEpoch,
      pubdateLocalActual: parsed.pubdateLocal,
      pagesPartActual: parsed.pages?.[0]?.part ?? null,
    }
  : null;

const report = {
  generatedAt: new Date().toISOString(),
  purpose: "Bilibili external link content verification (read-only; no login, no writes)",
  videoUrl: VIDEO_URL,
  apiUrl: API_URL,
  attempts: results.map((r) => ({ name: r.name, status: r.status ?? null, ok: r.ok, error: r.error ?? null, contentType: r.contentType ?? null, bodyBytes: r.bodyBytes ?? null, bodySha256: r.bodySha256 ?? null, capturedAtLocal: r.capturedAtLocal ?? null, rawFile: r.rawFile ?? null, bodyPrefix: r.bodyPrefix ?? null })),
  parsedApiFields: parsed,
  comparison,
  pageMeta,
  verdict,
  limits: [
    "若 Bilibili 风控返回 412/验证码/空 JSON，本审计只记 NOT_RUN，不根据链接猜测时长、播放量或视频内容。",
    "本轮只在本地发起只读 GET；未登录、未使用 Cookie、未写任何外部数据。",
  ],
  fieldsNotClaimed: ["视频内容是否完整展示产品能力（无法由链接或标题证明）", "页面不新增时长/播放量展示；如报告引用时长，必须标注为“平台 API 元数据，核验时间/方法”"],
  citationRule: "若 CLAIMS_ROUND2 引用 title/owner/duration，须同时给出 API URL、HTTP 200、code:0、核验时间（UTC+8）与 body sha256。",
};
fs.writeFileSync(path.join(jsonDir, "bilibili-link-verification.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));

