/**
 * Phase 1 汇总修正：把交互态解释性指标补进 metrics/MANIFEST/phase1-metrics，
 * 不改动任何截图文件。仅追加字段，便于报告引用。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../../..");
const OUT = path.join(ROOT, "evidence/final-sprint/20261103/b-brand-home/b1");

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const writeJson = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + "\n", "utf8");

// 1) A 依据展开态：first-80 不变是设计使然（依据追加在四问之后），补文字量变化与裁切说明
const evidencePath = path.join(OUT, "metrics/proto-a-1440-light-evidence.json");
const evidence = await readJson(evidencePath);
evidence.transition.evidenceOpen.panelTextLengthFrom = 131;
evidence.transition.evidenceOpen.panelTextLengthTo = 314;
evidence.transition.evidenceOpen.panelTextLengthChanged = true;
evidence.transition.evidenceOpen.panelTextFirst80UnchangedByDesign = true;
evidence.transition.evidenceOpen.evidencePanelClippedByViewport = true;
evidence.transition.evidenceOpen.leftColumnShiftY = 139.92;
await writeJson(evidencePath, evidence);

// 2) 交互态解释性汇总 + 源码状态（HEAD 已推进到 B1 提交 4be7a4b）
const phase1Path = path.join(OUT, "phase1-metrics.json");
const phase1 = await readJson(phase1Path);
phase1.sourceState = {
  baselineSha: "485d485378637e1da3280ed092739d441c8cf749",
  prototypeCommit: "4be7a4b9465e9ed922d7028b969df1dcf164ec1b",
  prototypeCommitSubject: "官网：B1 两款 Hero 原型与信息结构裁决",
  prototypeCommitTimeLocal: "2026-11-03T11:50:05+08:00",
  note: "B1 原型源码在该提交中；原型文件 mtime 11:40:35–11:41:59，Phase 1 两轮采集（约 11:48:30 与 11:50:49–11:51:07）期间原型文件未再改动，两轮截图对同一源码内容。",
  concurrentB2EditsAfterCapture: [
    "components/SiteHeader.tsx mtime 11:51:38",
    "components/HomeJourney.tsx mtime 11:52:30",
  ],
  concurrentEditImpact: "B2 首页改动发生在原型采集之后；原型页 pathname 非 / 时 SiteHeader 透传 layout header，两原型页不受首页营销页头改动影响。",
  evidenceCommitNote:
    "Lead 于 4be7a4b 提交了 Phase 1 第一轮快照；第二轮（含去除 dev “Compiling…” 覆盖物、新增 evidence-full 辅助视图、补解释字段）发生在提交之后，当前工作树证据需重新暂存。",
};
phase1.interactionNotes = {
  aDefaultToDuring: {
    ariaSelectedChanged: true,
    selectedTab: "02 期间",
    panelTextChanged: true,
    panelTextLength: { from: 131, to: 129 },
    activeElementAfterClick: "button: 02 期间（焦点留在被点 Tab）",
    scrollHeight: 930,
  },
  aEvidenceOpen: {
    evidenceButtonAriaExpanded: "true",
    evidencePanelVisible: true,
    panelTextLength: { from: 131, to: 314 },
    panelTextFirst80UnchangedByDesign: true,
    evidencePanelBBox: { y: 669.89, bottom: 935.33, height: 265.44, clippedByViewport: true },
    leftColumnShiftY: 139.92,
    activeElementAfterClick: "button: 收起依据（焦点留在触发按钮）",
    auxiliaryFullView: "proto-a-1440-light-evidence-full.png（scrollY=60，依据面板完整可见）",
  },
  bDefaultToMaterials: {
    sourcePanelVisible: true,
    sourcePanelId: "proto-b-source-requirements",
    sourcePanelTextLength: 63,
    panelTextLength: { from: 207, to: 273 },
    chipAriaExpanded: "比赛材料=true",
    leftColumnShiftY: 57.16,
    activeElementAfterClick: "button: 比赛材料（焦点留在触发 chip）",
    cardBottom: 900.3,
  },
  bMaterialsToTask: {
    sourcePanelVisible: true,
    sourcePanelId: "proto-b-source-task",
    sourcePanelTextLength: 71,
    panelTextLength: { from: 273, to: 281 },
    chipAriaExpanded: "任务安排=true",
    activeElementAfterClick: "button: 任务安排（焦点留在触发 chip）",
  },
  mobileFirstScreen: {
    "390x844": "A/B 的右栏工作包卡片自 y=439 开始，A 卡 bottom=1107、B 卡 bottom=1215，均越过 844 视口；首屏只见标题/说明/CTA/卡片顶部（A 见 Tab 与四问开头，B 见 01 来源与 chips 顶部）。",
  },
  devOnlyArtifacts: {
    devIndicator: "左下角 Next dev 工具按钮“N”在全部截图中可见（dev-only），390 宽时会覆盖面板左下文字；before/after 同环境保持一致。",
    compilingToast: "首次交互截图曾出现 “Compiling…” dev 提示，已通过等待 nextjs-portal 阴影 DOM 不再含 Compiling/Building 后重拍；最终 13 张均无该提示。",
  },
};
await writeJson(phase1Path, phase1);

// 3) MANIFEST：追加解释与视觉复核结论（不改变截图哈希）
const manifestPath = path.join(OUT, "MANIFEST.json");
const manifest = await readJson(manifestPath);
manifest.sourceState = phase1.sourceState;
manifest.interactionProtocol =
  "主图 8 张 = 2 路由 × 1440×900/390×844 × light/dark，scrollY=0 整视口；交互图 5 张 = A during / A evidence / A evidence 辅助全览（scrollY=60）/ B 比赛材料 / B 任务安排，均 1440 light。截图前等待 dev 覆盖物消失。";
manifest.interpretation = {
  horizontalOverflow: "13 个状态均无水平溢出（scrollWidth == innerWidth），无元素越界。",
  theme: "light/dark 均正确应用（html class、body 背景 rgb(247,246,242)/rgb(21,30,28)），两主题布局一致。",
  fonts: "document.fonts.status=loaded；PM Brand / PM Editorial 本地字体均 loaded；无外部字体域。",
  header: "两原型页使用同一 app 全局 header（非首页 SiteHeader）：1440 可见“演示模式”徽标，390 移动端折叠后不可见（badge=null 属预期）。",
  networkFailures:
    "99 条 failures 全部为 fetch：74 条 GET /api/auth/me 401（匿名访客预期，非写请求）+ 21 条导航打断的 RSC/静态资源 ERR_ABORTED + 4 条 401 且被中断；console error 78 条均为该 401 的资源加载提示。另有 1 条 font ERR_ABORTED（pm-editorial-serif.ttf，reload 打断旧页面字体请求，重载后 loaded）。无图片失败、无外域、无 /api 写请求、无 page error。",
  anonymousAuthProbes:
    "每次页面加载约 4–5 次 GET /api/auth/me（401），存在重复探测现象；仅为观测记录，不影响匿名页可读性与 CTA。",
  fairness:
    "同一 h1/副标题/CTA/mock 说明；可见文字量 B 比 A 多：heroSectionTextLength 393 vs 330（+63），右卡 lensTextLength 271 vs 208（+63），主内容 panelTextLength 207 vs 131（+76）。差异来自信息组织（A 四问紧凑、B 四步因果链），非文案量刻意拉大；比较时需连同信息结构一起看。",
  targets:
    "A：Tab 44px、查看依据/回到原委托 44px、CTA 48px（390 时 CTA 46px）；B：桌面 chips 高 40px（低于项目 44×44 目标），390 时 44px；两页 CTA 均 46–48px。",
  layoutShift:
    "展开依据/原文会拉高右栏，左栏文案在网格中垂直居中随之位移：A 依据展开 h1 +139.9px，B 原文展开 h1 +57.2px；属用户触发重排，非自动动画，但视觉上有明显跳动，建议 B2 选型时评估。",
  evidenceClipping:
    "A 依据面板 bottom=935 > 900 视口（scrollY=0 时被裁 35px），已补拍 scrollY=60 的完整视图；B 原文面板 bottom=466 完整可见，展开后卡片 bottom=900.3 基本贴视口下缘。",
};
manifest.visualReview = {
  reviewedAll: true,
  reviewedCount: 13,
  method: "逐张 read_image 实看（非仅生成）",
  notes: [
    "两页首屏结构一致：左文案 + 右工作包卡；默认态 A=“回来后”四问，B=完整四步因果链，均含“等你确认”状态徽标与“公开示例·不调用模型·不写入你的项目”边界说明。",
    "A 四问卡：Tab 01/02/03 + 四问行（变化/等你两行有暖色强调底），底部“查看依据/回到原委托”；期间态文案明确写“冻结的示例状态，不连接服务器”。",
    "B 因果链：01 来源（3 个 chip）→ 02 变化（强调节点）→ 03 判断改变（原来/现在对照）→ 04 等你；原文 chip 展开后行内出现引用面板。",
    "深色主题下卡片、分隔线、强调底与 chip 均正常，未见低对比或串色。",
    "移动端 390：两页工作包卡内容均延伸到首屏以下（卡自 y=439 起），首屏只能看到卡片顶部；CTA 与标题完整可见。",
    "dev 覆盖物：左下“N”按钮在 390 截图覆盖面板左下文字（dev-only）；已移除 “Compiling…” 提示。",
  ],
};
await writeJson(manifestPath, manifest);

// 4) b1/metrics/summary.json —— B1_COMPARISON.md 引用的两款文字量与关键差异汇总
const summary = {
  phase: 1,
  kind: "prototype-text-volume-and-key-diffs",
  generatedAt: new Date().toISOString(),
  sourceState: phase1.sourceState,
  note: "B1_COMPARISON.md 引用的汇总文件；数据取自 phase1-metrics.json / metrics/*.json，截图与指标同一次采集。",
  textVolume: {
    metricDefinitions: {
      heroSectionTextLength: "整个 hero 区（左文案 + 右工作包卡）可见文字总量，A/B 最可比",
      lensTextLength: "右侧工作包卡片可见文字总量",
      panelTextLength: "A=#proto-a-panel（四问+操作+依据）；B=主链 ol（四步因果链）；语义不同，不直接等同",
    },
    a: { heroSectionTextLength: 330, lensTextLength: 208, panelTextLength: 131 },
    b: { heroSectionTextLength: 393, lensTextLength: 271, panelTextLength: 207 },
    delta: { heroSectionTextLength: 63, lensTextLength: 63, panelTextLength: 76 },
    deltaPercent: { heroSectionTextLength: "19.1%", lensTextLength: "30.3%", panelTextLength: "58.0%" },
    sameCopy: ["h1「人可以下线，项目别掉线。」", "同一副标题", "同一 CTA（体验一段项目接续 / 进入工作台）", "同一模拟边界说明"],
  },
  defaults: {
    a: { selectedTab: "03 回来后", structure: "四问工作包（原委托/依据/变化/等你）", tabs: 3 },
    b: { selectedTab: null, structure: "四步因果链（来源/变化/判断改变/等你）", chips: 3 },
  },
  interactions: phase1.interactionNotes,
  layout: {
    desktop1440: { aCard: "y=148.8–719.8", bCard: "y=148.8–786.0", viewport: "900" },
    mobile390: { cardStartY: 439.02, aCardBottom: 1107.33, bCardBottom: 1214.52, viewport: "844" },
    horizontalOverflow: "13/13 状态均无",
  },
  targets: { aTabs: 44, aEvidenceButton: 44, aCtaDesktop: 48, bChipsDesktop: 40, bChipsMobile: 44, ctaMobile: 46 },
  network: { file: "b1/network-proto.json", externalOrigins: 0, apiWrites: 0, imageFontFailures: 1, note: "1 条字体请求为 reload 打断；console 401 为匿名探测" },
  screenshots: (manifest.files ?? []).filter((f) => f.kind === "screenshot").map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
};
await writeJson(path.join(OUT, "metrics/summary.json"), summary);

console.log(
  "patched:",
  ["metrics/proto-a-1440-light-evidence.json", "metrics/summary.json", "phase1-metrics.json", "MANIFEST.json"].join(", "),
);
