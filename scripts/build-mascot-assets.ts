/**
 * 书签精灵素材管线（一次性、可重跑）。
 *
 * 生图工具无法直接交付真实 alpha：它会把透明底烘焙成棋盘格，或在角色边缘留下幕布色。
 * 这里对纯蓝幕布原图做确定性去背、溢色抑制、统一画幅/落脚位置，并输出网页尺寸与 manifest。
 *
 * 运行：npm.cmd exec tsx -- scripts/build-mascot-assets.ts
 * 依赖：Next 已安装的 sharp；不参与生产运行。
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const RAW = path.resolve("tmp/mascot-raw");
const OUT = path.resolve("public/mascot/bookmark-spirit/v1");
const MASTER = path.join(OUT, "master");
const WEB = path.join(OUT, "web");
const CANVAS = 1024, BASELINE = 944;
const WEB_SIZE = 512, AVATAR_SIZE = 256;

const POSES: Record<string, { raw: string; label: string; usage: string; scale?: number }> = {
  idle: { raw: "Create_one_production_ready_fu_2026-11-17T12-56-12.png", label: "安静抱着项目夹", usage: "空闲、等待或静态陪伴" },
  inspect: { raw: "Create_one_production_ready_fu_2026-11-17T12-57-31.png", label: "看原记录、持放大镜", usage: "查看来源与导师核查" },
  thinking: { raw: "Create_one_production_ready_fu_2026-11-17T12-57-49.png", label: "轻托下巴、略显疑问", usage: "未知项、等待回答" },
  writing: { raw: "Create_one_production_ready_fu_2026-11-17T12-58-14.png", label: "坐在书堆上写稿", usage: "只在真实处理/写作状态使用", scale: 0.9 },
  handoff: { raw: "Create_one_production_ready_fu_2026-11-17T12-58-34.png", label: "递出项目夹", usage: "交回意见、成果交接" },
  success: { raw: "Create_one_production_ready_fu_2026-11-17T13-03-33.png", label: "夹好新页、轻微开心", usage: "有对应成功回执后短暂显示" },
};
const AVATAR_RAW = "Create_a_production_ready_avat_2026-11-17T12-57-13.png";

/** 读取边框估计幕布色与蓝幕布“绿红均值减蓝”基准，容忍轻微渐晕。 */
async function backdrop(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const points = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [W >> 1, 0], [W >> 1, H - 1], [0, H >> 1], [W - 1, H >> 1]];
  const sum = [0, 0, 0]; let key = 0;
  for (const [x, y] of points) {
    const i = (y * W + x) * 4;
    sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2];
    key += (data[i] + data[i + 1]) / 2 - data[i + 2];
  }
  return { color: sum.map(v => Math.round(v / points.length)), key: key / points.length };
}

/** 蓝幕布色键：用“绿红均值减蓝”区分幕布与角色，避免渐变底色被误判为角色。 */
async function cutout(file: string, clearWatermark: boolean) {
  const { color: B, key: bgKey } = await backdrop(file);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info, out = Buffer.from(data);
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const low = bgKey + 4, high = bgKey + 105;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = out[i], g = out[i + 1], b = out[i + 2];
    let a = (((r + g) / 2 - b) - low) / (high - low);
    // 右下角是生图工具的水印区；角色与纸带不进入该矩形。
    if (a < 0.04 || (clearWatermark && x > 840 && y > 900)) {
      // 透明像素也归零 RGB，否则 trim 会把幕布残色当成内容，无法裁到角色边界。
      out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0; continue;
    }
    if (a > 1) a = 1;
    if (a < 1) {
      out[i] = clamp(r / a);
      out[i + 1] = clamp((g - (1 - a) * B[1]) / a);
      out[i + 2] = clamp((b - (1 - a) * B[2]) / a);
    }
    const ceiling = Math.max(out[i], out[i + 1]);
    if (out[i + 2] > ceiling) out[i + 2] = ceiling;
    out[i + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png();
}

/** 只按不透明内容裁剪，忽略去背残留的极淡像素；否则角色会因边缘噪声整体上移。 */
async function contentBox(input: Buffer) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] <= 200) continue;
    if (x < left) left = x; if (x > right) right = x;
    if (y < top) top = y; if (y > bottom) bottom = y;
  }
  if (right < left || bottom < top) throw new Error("素材没有不透明内容");
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** 统一画幅：裁到不透明内容，水平居中，底边落在同一基线上；不缩放，保留各姿态自然比例。 */
async function normalized(input: ReturnType<typeof sharp>, size: number, scale = 1) {
  const source = await input.png().toBuffer();
  const box = await contentBox(source);
  let cropped = await sharp(source).extract(box).png().toBuffer({ resolveWithObject: true });
  if (scale !== 1) {
    const scaled = await sharp(cropped.data).resize({ width: Math.round(cropped.info.width * scale), kernel: "lanczos3" }).png().toBuffer({ resolveWithObject: true });
    cropped = { data: scaled.data, info: scaled.info } as typeof cropped;
  }
  const margin = Math.round(size * 0.03);
  if (cropped.info.width > size - margin * 2) {
    const scaled = await sharp(cropped.data).resize({ width: size - margin * 2, kernel: "lanczos3" }).png().toBuffer({ resolveWithObject: true });
    cropped = { data: scaled.data, info: scaled.info } as typeof cropped;
  }
  const { width, height } = cropped.info;
  // 先物化合成结果：sharp 的 composite 图层不会跟随后续 resize 一起缩放。
  const placed = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: cropped.data, left: Math.round((size - width) / 2), top: Math.max(0, Math.round(size * BASELINE / CANVAS) - height) }])
    .png().toBuffer();
  return sharp(placed);
}

async function main() {
  fs.mkdirSync(MASTER, { recursive: true }); fs.mkdirSync(WEB, { recursive: true });
  const manifest = {
    schemaVersion: 1, character: "bookmark-spirit", version: "v1", generatedAt: "2026-11-17",
    design: {
      spec: "docs/v2/assets/mascot-concepts/20261117/bookmark-spirit-v1/character-spec.png",
      prompts: "docs/v2/assets/mascot-concepts/20261117/bookmark-spirit-v1/PROMPTS.md",
      reference: "docs/v2/assets/mascot-concepts/20261117/02-bookmark-spirit-v1.png",
      note: "设计母版与提示词不参与页面加载；docs 目录按仓库约定不强制入库。",
    },
    tool: "WorkBuddy ImageGen（图生图）+ 本地确定性去背与统一基线",
    canvas: { master: CANVAS, web: WEB_SIZE, baseline: BASELINE, note: "同画幅、同基线；网页按实际尺寸加载 web 版本" },
    palette: { pine: "#27685D", ink: "#1C2E2C", ivory: "#F7F5EF", copper: "#BC7B4C" },
    states: {} as Record<string, unknown>,
  };
  for (const [pose, meta] of Object.entries(POSES)) {
    const source = path.join(RAW, meta.raw);
    const cut = await cutout(source, true);
    const master = await normalized(cut, CANVAS, meta.scale ?? 1);
    await master.clone().png({ compressionLevel: 9 }).toFile(path.join(MASTER, pose + ".png"));
    await master.clone().resize(WEB_SIZE, WEB_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
      .png({ compressionLevel: 9, quality: 92 }).toFile(path.join(WEB, pose + ".png"));
    const webMeta = await sharp(path.join(WEB, pose + ".png")).metadata();
    manifest.states[pose] = { label: meta.label, usage: meta.usage, master: "master/" + pose + ".png",
      web: "web/" + pose + ".png", width: webMeta.width, height: webMeta.height, hasAlpha: webMeta.hasAlpha,
      source: "ImageGen 图生图（master 参考）+ chroma key", webBytes: fs.statSync(path.join(WEB, pose + ".png")).size };
  }
  const avatar = await normalized(await cutout(path.join(RAW, AVATAR_RAW), true), CANVAS);
  await avatar.clone().png({ compressionLevel: 9 }).toFile(path.join(MASTER, "avatar.png"));
  await avatar.clone().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
    .png({ compressionLevel: 9, quality: 92 }).toFile(path.join(WEB, "avatar.png"));
  manifest.states.avatar = { label: "清晰的小头像", usage: "角色入口与提示，不替换品牌 Logo", master: "master/avatar.png",
    web: "web/avatar.png", width: AVATAR_SIZE, height: AVATAR_SIZE, hasAlpha: (await sharp(path.join(WEB, "avatar.png")).metadata()).hasAlpha,
    source: "ImageGen 图生图（master 参考）+ chroma key", webBytes: fs.statSync(path.join(WEB, "avatar.png")).size };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const file of fs.readdirSync(WEB)) {
    const size = fs.statSync(path.join(WEB, file)).size;
    console.log(file, Math.round(size / 1024) + "KB");
  }
}
await main();
