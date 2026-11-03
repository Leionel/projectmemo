/**
 * Track C EV2：Web 用户流程证据采集（Playwright，本地隔离库 + mock）。
 *
 * 边界：
 * - 只对 http://127.0.0.1:34112（Start-Track 环境：mock、prisma/final-preparation.db、无 Worker）操作；
 *   不 push、不部署、不写真实库、不调用外部模型/外部域。
 * - 不修改产品源码；只写 evidence/final-c/20261103/ 下的截图、日志、manifest。
 * - 由 `--probe` 在 EV1 只做浏览器能力核查；EV2 code green 后跑完整流程。
 *
 * 用法（仓库根目录）：
 *   node scripts/final-c/capture-web-evidence.mjs --probe
 *   node scripts/final-c/capture-web-evidence.mjs --base-url http://127.0.0.1:34112
 *   node scripts/final-c/capture-web-evidence.mjs --only normal
 *   node scripts/final-c/capture-web-evidence.mjs --only abnormal --filter stopped,cancelled
 *
 * 输出：
 *   evidence/final-c/20261103/manifest.json
 *   evidence/final-c/20261103/notes.md
 *   evidence/final-c/20261103/logs/requests-*.json
 *   evidence/final-c/20261103/screenshots/{normal,abnormal}/*.png
 *
 * 退出码：0 = 所有必跑检查 PASS；1 = 有 FAIL/脚本错误；2 = 环境不可用（服务未启动等）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(repoRoot, "evidence", "final-c", "20261103");
const identityPath = path.join(evidenceDir, "fixture-identity.json");
const manifestPath = path.join(evidenceDir, "manifest.json");
const notesPath = path.join(evidenceDir, "notes.md");
const screenshotRoot = path.join(evidenceDir, "screenshots");
const logDir = path.join(evidenceDir, "logs");
const legacySamplePath = path.join(
  repoRoot,
  "evidence",
  "final-a",
  "20261103",
  "samples",
  "a2",
  "a2-legacy-server-without-workpacket.json",
);

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.findIndex((value) => value === `--${name}`);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) return args[index + 1];
  const inline = args.find((value) => value.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}
const baseUrl = argValue("base-url", "http://127.0.0.1:34112").replace(/\/+$/, "");
const probeOnly = args.includes("--probe");
const only = argValue("only", "all"); // all | normal | abnormal
const filter = argValue("filter", "");
const mode = argValue("mode", "ev2"); // ev2 | dry
const runLabel = argValue("label", "validation"); // validation | final

const nowIso = () => new Date().toISOString();
const sanitize = (text, max = 300) =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
mkdirp(path.join(screenshotRoot, "normal"));
mkdirp(path.join(screenshotRoot, "abnormal"));
mkdirp(logDir);

function gitFacts() {
  const run = (cmdArgs) => {
    try {
      return execFileSync("git", cmdArgs, { cwd: repoRoot, encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  const headSha = run(["rev-parse", "HEAD"]) || "UNKNOWN";
  const dirtyPaths = run(["status", "--porcelain"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    headSha,
    shortSha: headSha.slice(0, 7),
    branch: run(["branch", "--show-current"]) || "UNKNOWN",
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
    capturedAt: nowIso(),
  };
}

function readIdentity() {
  if (!fs.existsSync(identityPath)) throw new Error(`找不到 fixture 身份文件：${identityPath}`);
  return JSON.parse(fs.readFileSync(identityPath, "utf8"));
}

function missionOf(identity, key) {
  const mission = (identity.missions ?? []).find((row) => row.key === key);
  if (!mission) throw new Error(`fixture 身份文件缺少 mission: ${key}`);
  return mission;
}

function missionUrl(identity, mission) {
  return `${baseUrl}/projects/${mission.projectId}/missions?mission=${mission.id}`;
}

function targetQuery(target = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(target)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `&${text}` : "";
}

// ---------------------------------------------------------------- 证据容器
const checks = [];
const cases = [];
const observations = {};
let currentCase = null;
/** 只做一次 UI 登录，随后把 storageState 复用到后续 context，避免重复认证写与登录页抖动。 */
let storageState = null;
let loginEvidence = null;
let loginFallbackUsed = false;

function addCheck(id, status, detail) {
  checks.push({ case: currentCase?.id ?? "global", id, status, detail: detail ?? null, at: nowIso() });
}
async function tryCheck(id, fn, detailLabel = "") {
  try {
    const value = await fn();
    addCheck(id, "PASS", detailLabel ? { label: detailLabel, value } : value ?? null);
    return value;
  } catch (error) {
    addCheck(id, "FAIL", { message: sanitize(error?.message ?? error, 800) });
    return undefined;
  }
}
function notRun(id, reason) {
  addCheck(id, "NOT_RUN", reason);
}

async function startCase(description, extra = {}) {
  const id = `${String(cases.length + 1).padStart(3, "0")}-${description.id}`;
  currentCase = {
    id,
    kind: description.kind,
    title: description.title,
    dataSource: description.dataSource,
    interception: description.interception ?? null,
    viewport: null,
    theme: null,
    startedAt: nowIso(),
    requests: [],
    consoleErrors: [],
    pageErrors: [],
    screenshots: [],
    checks: [],
    ...extra,
  };
  cases.push(currentCase);
  return currentCase;
}
function endCase() {
  const c = currentCase;
  if (!c) return;
  c.finishedAt = nowIso();
  c.checks = checks.filter((check) => check.case === c.id);
  c.requestAudit = summarizeRequests(c.requests);
  const requestLog = path.join(logDir, `requests-${c.id}.json`);
  fs.writeFileSync(requestLog, `${JSON.stringify(c.requests, null, 2)}\n`, "utf8");
  c.requestLogPath = path.relative(repoRoot, requestLog).replaceAll("\\", "/");
  delete c.requests;
  currentCase = null;
}

function attachAudit(page, record) {
  page.on("request", (request) => {
    record.requests.push({
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      isNavigation: request.isNavigationRequest(),
      at: nowIso(),
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") record.consoleErrors.push(sanitize(message.text(), 500));
  });
  page.on("pageerror", (error) => record.pageErrors.push(sanitize(error?.message ?? error, 500)));
}

/** 页面内部投影同步 POST 不算业务写，但必须被显式记录：/focus 挂载时调用 /api/conversations/sync。 */
const PAGE_INTERNAL_POSTS = new Set(["/api/conversations/sync"]);
/**
 * 既有 GoalQuestion 组件在页面加载时会为“呈现/曝光回执”调用 POST /goal-question（产品既有遥测写，
 * 不是 Mission 业务命令）。它违反“读取页只 GET”的严格口径，因此单列并写进 manifest 供 Lead 裁决，
 * 不当作本 Track 新增的业务写，也不能隐藏。
 */
const PAGE_COMPONENT_POSTS = [/\/api\/projects\/[^/]+\/goal-question$/];
function summarizeRequests(requests) {
  const base = new URL(baseUrl);
  const nonRead = requests.filter((request) => !["GET", "HEAD", "OPTIONS"].includes(request.method));
  const pathOf = (request) => {
    try {
      return new URL(request.url).pathname;
    } catch {
      return "";
    }
  };
  const pathInternalPosts = nonRead.filter((request) => PAGE_INTERNAL_POSTS.has(pathOf(request)));
  const pageComponentPosts = nonRead.filter(
    (request) =>
      !pathInternalPosts.includes(request) &&
      PAGE_COMPONENT_POSTS.some((pattern) => pattern.test(pathOf(request))),
  );
  const businessWrites = nonRead.filter(
    (request) => !pathInternalPosts.includes(request) && !pageComponentPosts.includes(request),
  );
  const external = requests.filter((request) => {
    try {
      return new URL(request.url).origin !== base.origin;
    } catch {
      return false;
    }
  });
  const apiRequests = requests.filter((request) => pathOf(request).startsWith("/api/"));
  return {
    total: requests.length,
    apiRequests: apiRequests.length,
    nonReadRequests: nonRead.length,
    businessWrites: businessWrites.map((request) => `${request.method} ${request.url}`),
    pageInternalPosts: pathInternalPosts.map((request) => `${request.method} ${request.url}`),
    pageComponentPosts: pageComponentPosts.map((request) => `${request.method} ${request.url}`),
    externalRequests: external.map((request) => `${request.method} ${request.url}`),
    methods: requests.reduce((acc, request) => {
      acc[request.method] = (acc[request.method] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

async function shot(page, group, name, record) {
  const file = path.join(screenshotRoot, group, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  record.screenshots.push(path.relative(repoRoot, file).replaceAll("\\", "/"));
  return file;
}

async function overflowReport(page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const docWidth = document.documentElement.scrollWidth;
    const bodyWidth = document.body ? document.body.scrollWidth : 0;
    const offenders = [];
    if (docWidth > width + 1 || bodyWidth > width + 1) {
      for (const element of Array.from(document.body?.querySelectorAll("*") ?? [])) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.right > width + 1 || rect.left < -1) {
          offenders.push({
            tag: element.tagName.toLowerCase(),
            className: String(element.className ?? "").slice(0, 80),
            text: (element.textContent ?? "").trim().slice(0, 60),
            right: Math.round(rect.right),
            left: Math.round(rect.left),
          });
          if (offenders.length >= 8) break;
        }
      }
    }
    return {
      innerWidth: width,
      documentScrollWidth: docWidth,
      bodyScrollWidth: bodyWidth,
      horizontalOverflow: docWidth > width + 1 || bodyWidth > width + 1,
      offenders,
    };
  });
}

async function setTheme(page, theme, { waitPacket = false } = {}) {
  await page.evaluate((value) => {
    try {
      localStorage.setItem("theme", value);
    } catch {
      /* ignore */
    }
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const applied = await page.evaluate(() => ({
    darkClass: document.documentElement.classList.contains("dark"),
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
  }));
  if (theme === "dark" && !applied.darkClass) throw new Error("暗色主题未生效（html 缺少 dark class）");
  if (theme === "light" && applied.darkClass) throw new Error("浅色主题未生效（html 仍有 dark class）");
  // Lead 抽查要求：reload 后必须等读回工作包重新出现再截图，不能拍“只有重新读取状态与回执按钮”的中间态。
  if (waitPacket) await waitForWorkPacket(page);
  return applied;
}

/** 等待真实读回工作包完成渲染：主操作按钮 + 四问标题同时可见。 */
async function waitForWorkPacket(page, { timeout = 30_000 } = {}) {
  await page.locator("#mission-agent").waitFor({ state: "visible", timeout });
  await page.locator("[data-mission-primary-action]").first().waitFor({ state: "visible", timeout });
  await page.getByText("做到哪", { exact: true }).first().waitFor({ state: "visible", timeout });
  await page.waitForTimeout(350);
}

/** 等待并滚动到“逐项依据与原文”，确保依据截图拍的是当前任务的依据区。 */
async function waitForBasis(page, { timeout = 20_000 } = {}) {
  const heading = page.getByText("逐项依据与原文", { exact: true }).first();
  await heading.waitFor({ state: "visible", timeout });
  await heading.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(250);
  return heading;
}

async function reducedMotionReport(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(150);
  const report = await page.evaluate(() => {
    const read = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
        scrollBehavior: style.scrollBehavior,
      };
    };
    const sample = document.querySelector("#mission-agent button, main button, main a");
    return {
      prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      body: read(document.body),
      sample: read(sample),
      mediaRulesApplied: document.styleSheets.length > 0,
    };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  return report;
}

function secondsOf(durationText) {
  return String(durationText ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.endsWith("ms") ? Number.parseFloat(part) / 1000 : Number.parseFloat(part)))
    .filter((value) => Number.isFinite(value));
}
function reducedMotionPass(report) {
  const durations = [
    ...secondsOf(report?.body?.transitionDuration),
    ...secondsOf(report?.body?.animationDuration),
    ...secondsOf(report?.sample?.transitionDuration),
  ];
  return report?.prefersReducedMotion === true && durations.every((value) => value <= 0.001);
}

async function keyboardReport(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  const sequence = [];
  for (let index = 0; index < 14; index += 1) {
    await page.keyboard.press("Tab");
    sequence.push(
      await page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) return { reached: false };
        const style = getComputedStyle(element);
        return {
          reached: true,
          tag: element.tagName.toLowerCase(),
          text: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 60),
          href: element.getAttribute("href") ?? null,
          outlineWidth: style.outlineWidth,
          outlineStyle: style.outlineStyle,
          boxShadow: style.boxShadow,
        };
      }),
    );
  }
  await page.keyboard.press("Shift+Tab");
  const returned = await page.evaluate(() => {
    const element = document.activeElement;
    return element && element !== document.body
      ? (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 60)
      : null;
  });
  const reached = sequence.filter((row) => row.reached);
  const distinct = new Set(reached.map((row) => `${row.tag}:${row.text}`)).size;
  const visibleFocus = reached.filter(
    (row) =>
      (row.outlineStyle && row.outlineStyle !== "none" && row.outlineWidth !== "0px") ||
      (row.boxShadow && row.boxShadow !== "none"),
  ).length;
  return { sequence, distinct, visibleFocus, returned };
}

// ---------------------------------------------------------------- 浏览器
async function launch() {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  return { browser, chromium };
}

async function newPage(browser, record, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({
    viewport,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    reducedMotion: "no-preference",
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();
  attachAudit(page, record);
  return { context, page };
}

async function login(page, identity) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const user = page.getByLabel("账号", { exact: true });
  const pass = page.getByLabel("密码", { exact: true });
  const submit = page.getByRole("button", { name: "登录工作台" });
  // dev 首次访问 /login 需要编译/水合；点击可能落在水合前，因此重试一次 UI 登录。
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (!isLoginPage(page)) return page.url();
    await user.waitFor({ state: "visible", timeout: 25_000 });
    await user.fill(identity.account.username);
    await pass.fill(identity.account.password);
    await submit.waitFor({ state: "visible", timeout: 15_000 });
    // Lead 要求的登录判定：等待 POST /api/auth/login 的 2xx 响应（不依赖 waitForURL 的 load 事件）。
    const loginResponsePromise = page
      .waitForResponse(
        (response) => {
          try {
            return (
              response.request().method() === "POST" &&
              new URL(response.url()).pathname === "/api/auth/login" &&
              response.status() >= 200 &&
              response.status() < 300
            );
          } catch {
            return false;
          }
        },
        { timeout: 25_000 },
      )
      .catch(() => null);
    await submit.click().catch(() => {});
    const loginResponse = await loginResponsePromise;
    const navigated = await page
      .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (loginResponse && (navigated || !isLoginPage(page))) {
      await page.waitForLoadState("networkidle").catch(() => {});
      return page.url();
    }
    await page.waitForTimeout(800);
    if (!isLoginPage(page)) return page.url();
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  // 最后兜底：用同一账号走认证端点建立会话（会写入 loginEvidence.method，不掩盖 UI 尝试）。
  const fallback = await page.request.post(`${baseUrl}/api/auth/login`, {
    data: { username: identity.account.username, password: identity.account.password },
  });
  if (!fallback.ok()) throw new Error(`UI 登录失败且认证端点兜底失败：${fallback.status()}`);
  loginFallbackUsed = true;
  await page.goto(`${baseUrl}/focus`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  return page.url();
}

/** 登录本身是认证写（POST /api/auth/login），单独记录，不计入页面读取审计。 */
async function loginForCase(page, identity, record) {
  const before = record.requests.length;
  const landing = await login(page, identity);
  record.authRequests = record.requests.splice(before).filter((request) => request.method !== "GET");
  return landing;
}

function isLoginPage(page) {
  return new URL(page.url()).pathname === "/login";
}

/**
 * 保证当前 page 已登录：
 * - 首次由 N1 真实 UI 登录，并保存 storageState 给后续 context 复用；
 * - 复用会话失效时，用同一账号通过认证端点重新建立会话（auth 写单独记录，不算页面业务写）。
 */
async function ensureSignedIn(page, identity, record) {
  if (!storageState) {
    const landing = await loginForCase(page, identity, record);
    storageState = await page.context().storageState();
    loginEvidence = {
      method: loginFallbackUsed ? "UI_LOGIN_WITH_API_FALLBACK" : "UI_LOGIN",
      landing,
      at: nowIso(),
    };
    return loginEvidence;
  }
  const me = await page.request.get(`${baseUrl}/api/auth/me`).catch(() => null);
  if (me && me.ok()) return { method: "STORAGE_STATE_REUSE", landing: page.url() };
  const before = record.requests.length;
  const response = await page.request.post(`${baseUrl}/api/auth/login`, {
    data: { username: identity.account.username, password: identity.account.password },
  });
  record.authRequests = [
    ...(record.authRequests ?? []),
    ...record.requests.splice(before).filter((request) => request.method !== "GET"),
  ];
  if (!response.ok()) throw new Error(`复用会话失效且重新登录失败：${response.status()}`);
  loginEvidence = { method: "API_RELOGIN", status: response.status(), at: nowIso() };
  return loginEvidence;
}

async function ensureBasisExpanded(page) {
  await waitForWorkPacket(page);
  const expanded = await expandBasis(page);
  await waitForBasis(page);
  await expandFirstExcerpt(page);
  return expanded;
}

async function openMission(
  page,
  identity,
  mission,
  target = mission.readTarget,
  { expectPacket = true, expectBasis = false, record = null } = {},
) {
  const url = `${missionUrl(identity, mission)}${targetQuery(target)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (isLoginPage(page)) {
    if (record) await ensureSignedIn(page, identity, record);
    else await login(page, identity);
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  await page.locator("#mission-agent").waitFor({ state: "visible", timeout: 30_000 });
  if (expectPacket) await waitForWorkPacket(page);
  else await page.waitForTimeout(1500);
  const readback = page.getByRole("region", { name: "原任务当前工作包与完成回执" });
  await readback.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(600);
  if (expectBasis) await ensureBasisExpanded(page);
  return { url, readback };
}

async function readbackText(page) {
  const region = page.getByRole("region", { name: "原任务当前工作包与完成回执" });
  if ((await region.count()) === 0) return "";
  return sanitize(await region.innerText().catch(() => ""), 6000);
}

async function mainText(page) {
  return sanitize(await page.locator("main").innerText().catch(() => ""), 8000);
}

/** 展开 C1 共用的“依据、原文与纠正入口”details；返回是否找到/已展开。 */
async function expandBasis(page) {
  const summary = page.getByText("展开依据、原文与纠正入口", { exact: true }).first();
  if ((await summary.count()) === 0) return { found: false, opened: false };
  const alreadyOpen = await summary.evaluate((el) => Boolean(el.closest("details")?.open));
  if (!alreadyOpen) await summary.click();
  await page.waitForTimeout(700);
  return { found: true, opened: true };
}

/** 展开第一条“查看原记录摘录”，用于截图原文摘录（没有摘录时不失败）。 */
async function expandFirstExcerpt(page) {
  const summary = page.getByText("查看原记录摘录", { exact: true }).first();
  if ((await summary.count()) === 0) return false;
  const alreadyOpen = await summary.evaluate((el) => Boolean(el.closest("details")?.open));
  if (!alreadyOpen) await summary.click();
  await page.waitForTimeout(400);
  return true;
}

function textHas(text, patterns) {
  return patterns.filter((pattern) =>
    pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern),
  );
}

// ---------------------------------------------------------------- 正常主线
async function runNormal(browser, identity) {
  const missionQuestion = missionOf(identity, "waitingUser");
  const missionSource = missionOf(identity, "sourceStates");
  const missionResult = missionOf(identity, "succeeded");

  // ---- N1 登录 + /focus ----
  {
    const record = await startCase({
      kind: "normal",
      id: "focus",
      title: "登录后进入 /focus（今日项目焦点，原 primaryContext 入口）",
      dataSource: "REAL_ISOLATED_DATABASE",
    });
    const { context, page } = await newPage(browser, record, { width: 1280, height: 900 });
    try {
      await tryCheck("login.viaUI", async () => loginForCase(page, identity, record), "login");
      await page.goto(`${baseUrl}/focus`, { waitUntil: "domcontentloaded" });
      await tryCheck("focus.headingVisible", async () => {
        await page.getByRole("heading", { name: "今日项目焦点", exact: true }).waitFor({ timeout: 30_000 });
        return "今日项目焦点";
      });
      await page.waitForTimeout(1500);
      const focusText = await mainText(page);
      observations.focus = {
        textSample: focusText.slice(0, 3000),
        missionLinks: await page
          .locator('a[href*="mission="]')
          .evaluateAll((links) =>
            links.slice(0, 12).map((link) => ({
              href: link.getAttribute("href"),
              text: (link.textContent ?? "").trim().slice(0, 120),
            })),
          ),
        hasPrimaryContext: /当前重点|currentContext|primaryContext/.test(focusText),
      };
      await tryCheck("focus.waitingMissionLinks", async () => {
        const links = observations.focus.missionLinks;
        if (!links.length) throw new Error("焦点页没有指向原 Mission 的链接");
        return links.length;
      });
      await tryCheck("focus.overflow1280", async () => {
        const report = await overflowReport(page);
        if (report.horizontalOverflow) throw new Error(JSON.stringify(report.offenders.slice(0, 3)));
        return report;
      });
      currentCase.viewport = "1280x900";
      currentCase.theme = "light";
      await shot(page, "normal", "focus-1280-light", record);
      await setTheme(page, "dark");
      currentCase.theme = "light+dark";
      await shot(page, "normal", "focus-1280-dark", record);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      await tryCheck("focus.overflow390", async () => {
        const report = await overflowReport(page);
        if (report.horizontalOverflow) throw new Error(JSON.stringify(report.offenders.slice(0, 3)));
        return report;
      });
      await shot(page, "normal", "focus-390-dark", record);
      await setTheme(page, "light");
      await shot(page, "normal", "focus-390-light", record);
      await tryCheck("focus.requestAudit", async () => {
        const audit = summarizeRequests(record.requests);
        if (audit.businessWrites.length) throw new Error(JSON.stringify(audit.businessWrites));
        if (audit.externalRequests.length) throw new Error(JSON.stringify(audit.externalRequests));
        return audit;
      });
    } catch (error) {
      addCheck('case.unexpectedError', 'FAIL', { message: sanitize(error?.message ?? error, 800) });
    } finally {
      await context.close();
      endCase();
    }
  }

  // ---- N2 原 Mission 详情：顶部四问 + 主操作 ----
  let answeredQuestion = null;
  {
    const record = await startCase({
      kind: "normal",
      id: "waiting-user-detail",
      title: "原 Mission 详情：顶部四问可见 + 原问题主操作导航",
      dataSource: "REAL_ISOLATED_DATABASE",
    });
    const { context, page } = await newPage(browser, record, { width: 1280, height: 900 });
    try {
      await ensureSignedIn(page, identity, record);
      const { readback } = await openMission(page, identity, missionQuestion);
      await tryCheck("mission.panelVisible", async () => {
        await page.locator("#mission-agent").waitFor({ timeout: 20_000 });
        return "mission-agent";
      });
      const packetText = await readbackText(page);
      const main = await mainText(page);
      observations.waitingUser = {
        panelText: main.slice(0, 6000),
        readbackText: packetText,
      };
      await tryCheck("mission.fourQuestions", async () => {
        const found = textHas(packetText || main, [/做到哪/, /依据/, /为何停/, /现在等谁/]);
        if (found.length < 4) {
          throw new Error(
            `只找到 ${found.length}/4 四问标签：${found.join(",")}；详见 observations.waitingUser`,
          );
        }
        return found;
      });
      await tryCheck("mission.primaryAction", async () => {
        const action = page.getByRole("button", { name: /回答原问题/ }).first();
        const link = page.getByRole("link", { name: /回答原问题/ }).first();
        if ((await action.count()) > 0) return { kind: "button", text: await action.innerText() };
        if ((await link.count()) > 0) return { kind: "link", text: await link.innerText() };
        throw new Error("工作包内没有找到“回答原问题”主操作");
      });
      currentCase.viewport = "1280x900";
      currentCase.theme = "light";
      await shot(page, "normal", "mission-waiting-user-1280-light", record);
      await setTheme(page, "dark", { waitPacket: true });
      currentCase.theme = "light+dark";
      await shot(page, "normal", "mission-waiting-user-1280-dark", record);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      await waitForWorkPacket(page).catch(() => {});
      await tryCheck("mission.overflow390", async () => {
        const report = await overflowReport(page);
        if (report.horizontalOverflow) throw new Error(JSON.stringify(report.offenders.slice(0, 3)));
        return report;
      });
      await shot(page, "normal", "mission-waiting-user-390-dark", record);
      await setTheme(page, "light", { waitPacket: true });
      await shot(page, "normal", "mission-waiting-user-390-light", record);

      // 原操作导航：点击主操作后，原问题区域应可见/聚焦；不提交时为 navigation-only。
      const questionNavigation = await tryCheck("mission.primaryActionNavigation", async () => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForTimeout(300);
        const action = page.getByRole("button", { name: /回答原问题/ }).first();
        const link = page.getByRole("link", { name: /回答原问题/ }).first();
        const before = page.url();
        if ((await action.count()) > 0) await action.click();
        else if ((await link.count()) > 0) await link.click();
        else throw new Error("主操作不可点击");
        await page.waitForTimeout(600);
        const urlChanged = page.url() !== before;
        const questionVisible = await page
          .getByText(/请补充设备 D 在 2026-10 的真实显存峰值/)
          .first()
          .isVisible()
          .catch(() => false);
        const textarea = page.locator('textarea[name="mission-answer"]');
        const textareaVisible = (await textarea.count()) > 0 && (await textarea.first().isVisible());
        return {
          urlChanged,
          questionVisible,
          textareaVisible,
          hash: new URL(page.url()).hash,
          primaryActionNavigated: urlChanged || questionVisible || textareaVisible,
        };
      });
      await tryCheck("mission.primaryActionIsNavigationOnly", async () => {
        const audit = summarizeRequests(record.requests);
        if (audit.businessWrites.length) throw new Error(JSON.stringify(audit.businessWrites));
        return "点击主操作后仍无业务写 POST";
      });
      const questionAnchor = await tryCheck("mission.questionAnchor", async () => {
        const anchor = page.locator("#mission-question");
        if ((await anchor.count()) === 0) throw new Error("缺少 #mission-question 原问题区域");
        const visible = await anchor.first().isVisible();
        if (!visible) throw new Error("#mission-question 原问题区域不可见");
        const text = sanitize(await anchor.first().innerText(), 500);
        return { visible, text };
      });
      observations.waitingUser.questionAnchorText = questionAnchor?.text ?? null;
      await shot(page, "normal", "mission-question-navigation-1280-light", record);

      // 提交一次原问题答复：只写隔离库，保留回执身份（requestId/问题 ID/版本）。
      answeredQuestion = await tryCheck("mission.answerQuestionReceipt", async () => {
        const textarea = page.locator('textarea[name="mission-answer"]').first();
        await textarea.waitFor({ timeout: 10_000 });
        const answer =
          "合成答复（仅隔离库）：2026-10 设备 D 显存峰值 6.8GB，batch=1，序列长度 2048，KV cache 开关未记录。";
        await textarea.fill(answer);
        const responsePromise = page.waitForResponse(
          (response) =>
            /\/api\/missions\/[^/]+\/input$/.test(new URL(response.url()).pathname) &&
            response.request().method() === "POST",
          { timeout: 20_000 },
        );
        await page.getByRole("button", { name: "补充并继续" }).click();
        const response = await responsePromise;
        const body = await response.json().catch(() => ({}));
        const requestBody = response.request().postDataJSON();
        const status = response.status();
        if (![200, 201, 202].includes(status)) {
          throw new Error(`提交被拒绝：${status} ${sanitize(JSON.stringify(body), 400)}`);
        }
        await page.waitForTimeout(1500);
        await shot(page, "normal", "mission-question-receipt-1280-light", record);
        return {
          requestId: requestBody?.requestId ?? null,
          questionId: requestBody?.questionId ?? null,
          expectedVersion: requestBody?.expectedVersion ?? null,
          httpStatus: status,
          responseMission: body?.mission
            ? { id: body.mission.id, status: body.mission.status, version: body.mission.version }
            : null,
          answerChars: answer.length,
        };
      });
      await tryCheck("mission.answerOnlyIsolatedWrite", async () => {
        const audit = summarizeRequests(record.requests);
        const allows = ["/input"];
        const unexpected = audit.businessWrites.filter(
          (entry) => !allows.some((suffix) => entry.includes(suffix)),
        );
        if (unexpected.length) throw new Error(JSON.stringify(unexpected));
        return { businessWrites: audit.businessWrites, note: "只提交原问题答复到隔离库" };
      });
      await tryCheck("mission.overflowAfterAnswer", async () => {
        const report = await overflowReport(page);
        if (report.horizontalOverflow) throw new Error(JSON.stringify(report.offenders.slice(0, 3)));
        return report;
      });
      observations.answeredQuestion = answeredQuestion;
    } catch (error) {
      addCheck('case.unexpectedError', 'FAIL', { message: sanitize(error?.message ?? error, 800) });
    } finally {
      await context.close();
      endCase();
    }
  }

  // ---- N3 依据 / 原文 / 纠正入口（来源抑制 / 修订变化）----
  {
    const record = await startCase({
      kind: "normal",
      id: "basis-evidence",
      title: "依据 / 原文 / 纠正入口：来源 SUPPRESSED / CHANGED / UNKNOWN",
      dataSource: "REAL_ISOLATED_DATABASE",
    });
    const { context, page } = await newPage(browser, record, { width: 1280, height: 900 });
    try {
      await ensureSignedIn(page, identity, record);
      await openMission(page, identity, missionSource, missionSource.readTarget, {
        expectPacket: true,
        expectBasis: true,
        record,
      });
      const preparations = [];
      async function prepareBasisView(theme, width, height) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        if (theme) await setTheme(page, theme, { waitPacket: true });
        else await waitForWorkPacket(page);
        const expanded = await expandBasis(page);
        await waitForBasis(page);
        await expandFirstExcerpt(page);
        preparations.push({ theme: theme ?? "light", width });
        return expanded;
      }
      await prepareBasisView(null, 1280, 900);
      const packetText = await readbackText(page);
      const main = await mainText(page);
      observations.basis = {
        preparations,
        readbackText: packetText,
        panelText: main.slice(0, 8000),
      };
      await tryCheck("basis.sectionVisible", async () => {
        const found = textHas(packetText || main, [/逐项依据与原文/, /依据/, /原文/, /纠正/]);
        if (found.length === 0) throw new Error("读回区域内没有找到依据/原文/纠正入口");
        return found.map(String);
      });
      await tryCheck("basis.currentVsRevisionSeparated", async () => {
        const uses = textHas(packetText, [/当前使用资格/]);
        const revision = textHas(packetText, [/修订状态/]);
        if (!uses.length || !revision.length) {
          throw new Error(`当前许可与修订状态没有分开显示（use=${uses.length}, revision=${revision.length}）`);
        }
        return { currentUseLabel: uses.length, revisionLabel: revision.length };
      });
      await tryCheck("basis.suppressedNotRecommended", async () => {
        const found = textHas(packetText, [/当前许可已被撤回/, /不作为当前推荐或默认引用/]);
        if (!found.length) throw new Error("被抑制来源没有明确标注为不可作为当前推荐");
        return found.map(String);
      });
      await tryCheck("basis.changed", async () => {
        const found = textHas(packetText, [/原修订已变化/, /历史留痕保留/]);
        if (!found.length) throw new Error("修订变化没有独立展示");
        return found.map(String);
      });
      await tryCheck("basis.unknown", async () => {
        const found = textHas(packetText, [/当前来源链未知/, /不用于当前推荐/]);
        if (!found.length) throw new Error("来源链未知没有展示");
        return found.map(String);
      });
      await tryCheck("basis.correctionEntry", async () => {
        if (!/纠正/.test(packetText)) throw new Error("依据区没有纠正入口或纠正说明");
        return textHas(packetText, [/纠正影响后续理解/, /暂不提供纠正入口/, /纠正/]).map(String);
      });
      observations.basis.stateText = textHas(packetText, [
        /当前许可已被撤回/,
        /原修订已变化/,
        /当前来源链未知/,
        /当前允许作为依据/,
      ]).map(String);
      // Lead 抽查要求：被抑制来源必须同时显示“当前许可已被撤回”和“原修订匹配”两行，
      // 单独对这条来源项截图，避免整页截图里看不清。
      const suppressedItemEvidence = await tryCheck("basis.suppressedItemBothRows", async () => {
        const item = page.locator("li").filter({ hasText: "当前许可已被撤回" }).first();
        if ((await item.count()) === 0) throw new Error("没有找到被抑制来源项");
        const text = await item.innerText();
        const hasCurrent = /当前许可已被撤回/.test(text);
        const hasRevision = /原修订匹配/.test(text);
        if (!hasCurrent || !hasRevision) {
          throw new Error(`抑制项没有同时显示两行：${sanitize(text, 400)}`);
        }
        await item.scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const file = path.join(screenshotRoot, "normal", "basis-suppressed-item-1280-light.png");
        await item.screenshot({ path: file, animations: "disabled" });
        record.screenshots.push(path.relative(repoRoot, file).replaceAll("\\", "/"));
        return { hasCurrent, hasRevision, text: sanitize(text, 400) };
      });
      observations.basis.suppressedItem = suppressedItemEvidence ?? null;
      currentCase.viewport = "1280x900";
      currentCase.theme = "light";
      await shot(page, "normal", "basis-expanded-1280-light", record);
      await prepareBasisView("dark", 1280, 900);
      currentCase.theme = "light+dark";
      await shot(page, "normal", "basis-expanded-1280-dark", record);
      await prepareBasisView("dark", 390, 844);
      await tryCheck("basis.overflow390", async () => {
        const report = await overflowReport(page);
        if (report.horizontalOverflow) throw new Error(JSON.stringify(report.offenders.slice(0, 3)));
        return report;
      });
      await shot(page, "normal", "basis-expanded-390-dark", record);
      await prepareBasisView("light", 390, 844);
      await shot(page, "normal", "basis-expanded-390-light", record);
      await tryCheck("basis.requestAudit", async () => {
        const audit = summarizeRequests(record.requests);
        if (audit.businessWrites.length) throw new Error(JSON.stringify(audit.businessWrites));
        return audit;
      });
    } catch (error) {
      addCheck('case.unexpectedError', 'FAIL', { message: sanitize(error?.message ?? error, 800) });
    } finally {
      await context.close();
      endCase();
    }
  }

  // ---- N4 结果与 Action/resultCardId 回执核对 ----
  {
    const record = await startCase({
      kind: "normal",
      id: "results-receipts",
      title: "结果与 Action/resultCardId 回执：显示身份与 fixture-identity.json 一致",
      dataSource: "REAL_ISOLATED_DATABASE",
    });
    const { context, page } = await newPage(browser, record, { width: 1280, height: 900 });
    try {
      await ensureSignedIn(page, identity, record);
      const { readback } = await openMission(page, identity, missionResult, missionResult.readTarget);
      const packetText = await readbackText(page);
      const main = await mainText(page);
      const targets = missionResult.targets ?? {};
      observations.results = {
        readbackText: packetText,
        panelText: main.slice(0, 6000),
        identity: {
          outputId: targets.outputId ?? null,
          receiptId: targets.receiptId ?? null,
          artifactId: targets.artifactId ?? null,
          actionId: targets.actionId ?? null,
          resultCardId: targets.resultCardId ?? null,
        },
      };
      const preparations = [];
      async function prepareResultsView(theme, width, height) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        if (theme) await setTheme(page, theme, { waitPacket: true });
        else await waitForWorkPacket(page);
        await expandBasis(page);
        await waitForBasis(page);
        await expandFirstExcerpt(page);
        const classification = page.getByText("结果分类与支持上限", { exact: true }).first();
        await classification.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
        preparations.push({ theme: theme ?? "light", width });
      }
      await prepareResultsView(null, 1280, 900);
      const expandedText = await readbackText(page);
      observations.results.preparations = preparations;
      observations.results.expandedBasisText = expandedText;
      const actual = {
        resultCardHrefs: await page
          .locator(`a[href*="card-"]`)
          .evaluateAll((links) => links.map((link) => link.getAttribute("href")).slice(0, 20)),
        actionHrefs: await page
          .locator(`a[href*="action-"]`)
          .evaluateAll((links) => links.map((link) => link.getAttribute("href")).slice(0, 20)),
        artifactHrefs: await page
          .locator(`a[href*="artifact="]`)
          .evaluateAll((links) => links.map((link) => link.getAttribute("href")).slice(0, 20)),
      };
      observations.results.actualHrefs = actual;
      await tryCheck("results.classification", async () => {
        const found = textHas(expandedText, [
          /结果分类与支持上限/,
          /已执行：4/,
          /用户报告：1/,
          /已独立支持：0/,
        ]);
        if (found.length < 4) {
          throw new Error(
            `结果分类不完整（${found.length}/4）：${found.map(String).join(",")}；详见 observations.results.expandedBasisText`,
          );
        }
        return found.map(String);
      });
      await tryCheck("results.correctionEntry", async () => {
        if (!/纠正/.test(expandedText)) throw new Error("依据展开区没有纠正入口");
        return textHas(expandedText, [/纠正影响后续理解/, /纠正/]).map(String);
      });
      await tryCheck("results.outputReference", async () => {
        const found = textHas(expandedText, [/查看草稿版本 1/, /查看原草稿/]);
        if (!found.length) throw new Error("依据区没有指向原草稿版本的引用");
        return found.map(String);
      });
      await tryCheck("results.actionReceiptIdentity", async () => {
        const resultCardId = targets.resultCardId;
        if (!resultCardId) throw new Error("fixture 未记录 resultCardId");
        const hit = actual.resultCardHrefs.some((href) => href?.includes(`#card-${resultCardId}`));
        if (!hit) throw new Error(`页面上没有 resultCardId=${resultCardId} 的回执链接`);
        return { resultCardId, hrefs: actual.resultCardHrefs };
      });
      await tryCheck("results.actionIdentity", async () => {
        const actionId = targets.actionId;
        if (!actionId) throw new Error("fixture 未记录 actionId");
        const hit = actual.actionHrefs.some((href) => href?.includes(`#action-${actionId}`));
        if (!hit) throw new Error(`页面上没有 actionId=${actionId} 的行动链接`);
        return { actionId, hrefs: actual.actionHrefs };
      });
      await tryCheck("results.adoptionIdentity", async () => {
        const artifactId = targets.artifactId;
        if (!artifactId) throw new Error("fixture 未记录 artifactId");
        const hit = actual.artifactHrefs.some((href) => href?.includes(`artifact=${artifactId}`));
        if (!hit) throw new Error(`页面上没有 artifactId=${artifactId} 的归入链接`);
        return { artifactId, hrefs: actual.artifactHrefs };
      });
      currentCase.viewport = "1280x900";
      currentCase.theme = "light";
      await shot(page, "normal", "results-receipts-1280-light", record);
      await prepareResultsView("dark", 1280, 900);
      currentCase.theme = "light+dark";
      await shot(page, "normal", "results-receipts-1280-dark", record);
      await prepareResultsView("dark", 390, 844);
      await tryCheck("results.overflow390", async () => {
        const report = await overflowReport(page);
        if (report.horizontalOverflow) throw new Error(JSON.stringify(report.offenders.slice(0, 3)));
        return report;
      });
      await shot(page, "normal", "results-receipts-390-dark", record);
      await prepareResultsView("light", 390, 844);
      await shot(page, "normal", "results-receipts-390-light", record);
      await tryCheck("results.requestAudit", async () => {
        const audit = summarizeRequests(record.requests);
        if (audit.businessWrites.length) throw new Error(JSON.stringify(audit.businessWrites));
        if (audit.externalRequests.length) throw new Error(JSON.stringify(audit.externalRequests));
        return audit;
      });
    } catch (error) {
      addCheck('case.unexpectedError', 'FAIL', { message: sanitize(error?.message ?? error, 800) });
    } finally {
      await context.close();
      endCase();
    }
  }

  // ---- N5 键盘 Tab / 焦点返回 + 减弱动效（在原 Mission 详情页）----
  {
    const record = await startCase({
      kind: "normal",
      id: "keyboard-motion",
      title: "键盘 Tab 顺序、焦点返回与 prefers-reduced-motion",
      dataSource: "REAL_ISOLATED_DATABASE",
    });
    const { context, page } = await newPage(browser, record, { width: 1280, height: 900 });
    try {
      await ensureSignedIn(page, identity, record);
      await openMission(page, identity, missionQuestion);
      const keyboard = await tryCheck("a11y.keyboardTab", async () => {
        const report = await keyboardReport(page);
        if (report.distinct < 3) throw new Error(`Tab 只到达 ${report.distinct} 个不同元素`);
        if (report.visibleFocus < 2) throw new Error(`焦点可见指示不足：${report.visibleFocus}`);
        if (!report.returned) throw new Error("Shift+Tab 后焦点没有返回可聚焦元素");
        return { distinct: report.distinct, visibleFocus: report.visibleFocus, returned: report.returned, sequence: report.sequence.slice(0, 8) };
      });
      observations.keyboard = keyboard;
      const motion = await tryCheck("a11y.reducedMotion", async () => {
        const report = await reducedMotionReport(page);
        if (!reducedMotionPass(report)) throw new Error(JSON.stringify(report));
        return report;
      });
      observations.reducedMotion = motion;
      await shot(page, "normal", "keyboard-motion-1280-light", record);
    } catch (error) {
      addCheck('case.unexpectedError', 'FAIL', { message: sanitize(error?.message ?? error, 800) });
    } finally {
      await context.close();
      endCase();
    }
  }
}

// ---------------------------------------------------------------- 异常态
async function runAbnormal(browser, identity) {
  const wanted = filter
    ? new Set(filter.split(",").map((value) => value.trim()).filter(Boolean))
    : null;
  const enabled = (key) => !wanted || wanted.has(key);

  // A1 旧后端缺 workPacket：截获真实 A2 真实序列化样本的 readback（非真实旧后端）。
  if (enabled("legacy")) {
    const record = await startCase({
      kind: "abnormal",
      id: "legacy-missing-workpacket",
      title: "旧后端缺 workPacket：退回原详情、不构造默认成功事实",
      dataSource: "INTERCEPTED_A2_SAMPLE（截获真实 A 样本 readback，非真实旧后端）",
      interception: {
        route: "**/api/missions/*/readback*",
        source: legacySamplePath,
        change: "用 a2-legacy-server-without-workpacket.json 的 readback 替换响应体（status 200）",
      },
    });
    const { context, page } = await newPage(browser, record, { width: 1280, height: 900 });
    try {
      await ensureSignedIn(page, identity, record);
      const mission = missionOf(identity, "waitingUser");
      const sample = JSON.parse(fs.readFileSync(legacySamplePath, "utf8"));
      await page.route("**/api/missions/*/readback*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({ readback: sample.readback }),
        });
      });
      await page.goto(`${missionUrl(identity, mission)}${targetQuery(mission.readTarget)}`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#mission-agent").waitFor({ timeout: 30_000 });
      const legacyRegion = page.getByRole("region", { name: "原任务当前工作包与完成回执" });
      await legacyRegion.waitFor({ timeout: 20_000 }).catch(() => {});
      await page.getByText("当前摘要暂未提供", { exact: false }).first().waitFor({ timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(800);
      const main = await mainText(page);
      const legacyText = await readbackText(page);
      observations.legacyMissingWorkpacket = {
        mainText: main.slice(0, 5000),
        readbackText: legacyText,
      };
      await tryCheck("abnormal.legacy.detailPreserved", async () => {
        if (!/核对设备 D 在 2026-10 的真实显存峰值/.test(main)) throw new Error("原委托目标未保留");
        return "原委托详情可见";
      });
      await tryCheck("abnormal.legacy.noFakeSuccess", async () => {
        // 只检查读回/工作包区域：侧栏委托列表与 /api/missions/:id 原详情
        // （“成果核验与现实结果”块）属于未截获的真实服务端事实，不能算作工作包伪造成功。
        if (!legacyText) throw new Error("旧后端截获后读回区域没有渲染（可能仍在加载）");
        const fake = textHas(legacyText, [/完成条件已通过/, /查看原结果/, /已归入成果/]);
        if (fake.length) throw new Error(`旧后端缺工作包时读回区域出现成功语义：${fake.join(",")}`);
        const fourQuestions = textHas(legacyText, [/做到哪/, /依据是什么/, /为何停下/, /现在等谁/]);
        if (fourQuestions.length) throw new Error(`旧后端缺工作包时读回区域仍构造了四问：${fourQuestions.join(",")}`);
        const hint = textHas(legacyText, [/摘要暂未提供/, /旧服务/, /不据此推断成功/]);
        if (!hint.length) throw new Error("旧后端缺工作包没有“当前摘要暂未提供”的降级说明");
        return {
          hint: hint.map(String),
          fourQuestions: 0,
          fakeSemantics: 0,
          explanation:
            "页面其它区域仍显示未截获的 /api/missions/:id 原详情真实事实（含既有“成果核验与现实结果”块）；本次仅替换 readback 响应，不据此推断工作包成功。",
          readbackText: sanitize(legacyText, 500),
        };
      });
      currentCase.viewport = "1280x900";
      currentCase.theme = "light";
      await shot(page, "abnormal", "legacy-missing-workpacket-1280-light", record);
      await tryCheck("abnormal.legacy.requestAudit", async () => {
        const audit = summarizeRequests(record.requests);
        if (audit.businessWrites.length) throw new Error(JSON.stringify(audit.businessWrites));
        return audit;
      });
    } catch (error) {
      addCheck('case.unexpectedError', 'FAIL', { message: sanitize(error?.message ?? error, 800) });
    } finally {
      await context.close();
      endCase();
    }
  }

  // A2 VERSION_ADVANCED：截获真实响应并注入 consistency 变体。
  if (enabled("version-advanced")) {
    const record = await startCase({
      kind: "abnormal",
      id: "version-advanced",
      title: "VERSION_ADVANCED：读回快照版本推进提示",
      dataSource: "REAL_RESPONSE_MUTATED（真实隔离库响应 + 注入 snapshot.consistency=VERSION_ADVANCED，非真实并发推进）",
      interception: {
        route: "**/api/missions/*/readback*",
        change: "fetch 真实响应后把 workPacket.snapshot.consistency 改为 VERSION_ADVANCED 并追加 SNAPSHOT_VERSION_ADVANCED 阻断",
      },
    });
    const { context, page } = await newPage(browser, record, { width: 1280, height: 900 });
    try {
      await ensureSignedIn(page, identity, record);
      const mission = missionOf(identity, "waitingUser");
      /** 对本会话所有 readback 响应生效（含 React StrictMode 双请求），并记录每次拦截体用于诊断。 */
      const interceptedReadbacks = [];
      await page.route("**/api/missions/*/readback*", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        if (body?.readback?.workPacket) {
          body.readback.workPacket.snapshot.consistency = "VERSION_ADVANCED";
          body.readback.workPacket.snapshot.retries = 2;
          body.readback.workPacket.snapshot.note =
            "读取期间版本已推进且未在快照内收敛；提交前必须重新核对全部版本，不得混用新旧事实 (INTERCEPTED_VARIANT)";
          const blockers = Array.isArray(body.readback.workPacket.blockers)
            ? body.readback.workPacket.blockers
            : [];
          if (!blockers.some((blocker) => blocker.code === "SNAPSHOT_VERSION_ADVANCED")) {
            blockers.push({
              kind: "WORK_STATE",
              code: "SNAPSHOT_VERSION_ADVANCED",
              text: "读取期间版本已推进且未在快照内收敛；提交前必须重新核对全部版本，不得混用新旧事实",
              at: new Date().toISOString(),
              blocksActions: true,
              originalRef: { kind: "MISSION", id: mission.id },
            });
          }
          body.readback.workPacket.blockers = blockers;
        }
        interceptedReadbacks.push({
          at: nowIso(),
          method: route.request().method(),
          url: route.request().url(),
          httpStatus: response.status(),
          hadWorkPacket: Boolean(body?.readback?.workPacket),
          consistency: body?.readback?.workPacket?.snapshot?.consistency ?? null,
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify(body),
        });
      });
      await openMission(page, identity, mission, mission.readTarget, { expectPacket: true, record });
      const alertWaited = await page
        .getByRole("alert")
        .first()
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      await page.waitForTimeout(600);
      const region = await readbackText(page);
      observations.versionAdvanced = { readbackText: region, alertWaited, interceptedReadbacks };
      await tryCheck("abnormal.versionAdvanced.interceptionApplied", async () => {
        if (!interceptedReadbacks.length) throw new Error("没有任何 readback 请求被拦截");
        const mutated = interceptedReadbacks.filter((row) => row.consistency === "VERSION_ADVANCED");
        if (!mutated.length) {
          throw new Error(`拦截响应未携带 VERSION_ADVANCED：${JSON.stringify(interceptedReadbacks)}`);
        }
        return { responses: interceptedReadbacks.length, mutated: mutated.length };
      });
      await tryCheck("abnormal.versionAdvanced.noticeVisible", async () => {
        const found = textHas(region, [/版本/, /重新核对/, /快照/]);
        if (!found.length) {
          throw new Error(
            `读回区域没有版本推进提示（alertWaited=${alertWaited}；拦截=${JSON.stringify(interceptedReadbacks)}）`,
          );
        }
        return { found: found.map(String), alertWaited, responses: interceptedReadbacks.length };
      });
      currentCase.viewport = "1280x900";
      currentCase.theme = "light";
      await shot(page, "abnormal", "version-advanced-1280-light", record);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      await tryCheck("abnormal.versionAdvanced.overflow390", async () => {
        const report = await overflowReport(page);
        if (report.horizontalOverflow) throw new Error(JSON.stringify(report.offenders.slice(0, 3)));
        return report;
      });
      await shot(page, "abnormal", "version-advanced-390-light", record);
    } catch (error) {
      addCheck('case.unexpectedError', 'FAIL', { message: sanitize(error?.message ?? error, 800) });
    } finally {
      await context.close();
      endCase();
    }
  }

  // A3 409 WORK_PACKET_AUTHORITY_CHANGED
  if (enabled("409")) {
    const record = await startCase({
      kind: "abnormal",
      id: "409-authority-changed",
      title: "409 WORK_PACKET_AUTHORITY_CHANGED：读回失败提示且不自动沿用旧资格",
      dataSource: "INTERCEPTED_RESPONSE（截获 409 + error.code=WORK_PACKET_AUTHORITY_CHANGED）",
      interception: {
        route: "**/api/missions/*/readback*",
        change: "返回 409 {error:{code:WORK_PACKET_AUTHORITY_CHANGED,message}}",
      },
    });
    const { context, page } = await newPage(browser, record, { width: 1280, height: 900 });
    try {
      await ensureSignedIn(page, identity, record);
      const mission = missionOf(identity, "waitingUser");
      const readbackResponses = [];
      page.on("response", (response) => {
        try {
          const pathname = new URL(response.url()).pathname;
          if (/\/api\/missions\/[^/]+\/readback$/.test(pathname)) {
            readbackResponses.push({ at: nowIso(), status: response.status() });
          }
        } catch {
          /* ignore */
        }
      });
      await page.route("**/api/missions/*/readback*", async (route) => {
        await route.fulfill({
          status: 409,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({
            error: {
              code: "WORK_PACKET_AUTHORITY_CHANGED",
              message: "读取期间来源或权限持续变化，请重新读取原委托后核对",
            },
          }),
        });
      });
      await page.goto(`${missionUrl(identity, mission)}${targetQuery(mission.readTarget)}`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#mission-agent").waitFor({ timeout: 30_000 });
      const readbackRegion = page.getByRole("region", { name: "原任务当前工作包与完成回执" });
      await readbackRegion.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      // 等待 409 错误提示真正渲染（不拍加载态）。
      const noticeWaited = await page
        .getByText(/读取期间来源或权限持续变化|重新读取原委托后核对/)
        .first()
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      await page.waitForTimeout(600);
      const region = await readbackText(page);
      const main = await mainText(page);
      observations.authorityChanged409 = {
        readbackText: region,
        mainText: main.slice(0, 4000),
        noticeWaited,
        readbackResponses,
      };
      await tryCheck("abnormal.409.visible", async () => {
        const found = textHas(region || main, [/读取期间来源或权限/, /重新读取/, /409/]);
        if (!found.length) {
          throw new Error(
            `409 没有在页面上显示提示（noticeWaited=${noticeWaited}；readbackResponses=${JSON.stringify(readbackResponses)}）`,
          );
        }
        return { found: found.map(String), noticeWaited, readbackResponses };
      });
      await tryCheck("abnormal.409.noAutoContinue", async () => {
        const dangerous = textHas(main, [/已自动沿用/, /继续执行/]);
        if (dangerous.length) throw new Error(`409 后出现自动沿用语义：${dangerous.join(",")}`);
        return "未发现自动沿用旧资格";
      });
      currentCase.viewport = "1280x900";
      currentCase.theme = "light";
      await shot(page, "abnormal", "409-authority-changed-1280-light", record);
    } catch (error) {
      addCheck('case.unexpectedError', 'FAIL', { message: sanitize(error?.message ?? error, 800) });
    } finally {
      await context.close();
      endCase();
    }
  }

  // A4 401 / 403 / 404：确认私有缓存清空
  for (const status of [401, 403, 404]) {
    const key = `http-${status}`;
    if (!enabled(key)) continue;
    const record = await startCase({
      kind: "abnormal",
      id: key,
      title: `${status} 读回失败：确认私有缓存清空、不保留上一次结果`,
      dataSource: `INTERCEPTED_RESPONSE（先显示真实隔离库结果，再截获 ${status}）`,
      interception: {
        route: "**/api/missions/*/readback*",
        change: `首次放行真实响应，触发重读时返回 ${status}`,
      },
    });
    const { context, page } = await newPage(browser, record, { width: 1280, height: 900 });
    try {
      await ensureSignedIn(page, identity, record);
      const mission = missionOf(identity, "succeeded");
      await openMission(page, identity, mission, mission.readTarget, {
        expectPacket: true,
        expectBasis: false,
        record,
      });
      await page
        .getByText(/指定草稿版本 1|查看原复盘回执|已归入成果/)
        .first()
        .waitFor({ state: "visible", timeout: 20_000 })
        .catch(() => {});
      await page.waitForTimeout(600);
      const readback = page.getByRole("region", { name: "原任务当前工作包与完成回执" });
      const before = await readbackText(page);
      await tryCheck(`abnormal.${status}.privateLoaded`, async () => {
        if (!/核对设备 D|显示身份|查看复盘记录|读取于/.test(before)) {
          throw new Error("首次读取没有拿到私有回执内容");
        }
        return sanitize(before, 400);
      });
      let intercepted = false;
      await page.route("**/api/missions/*/readback*", async (route) => {
        intercepted = true;
        await route.fulfill({
          status,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({
            error: {
              code:
                status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : "NOT_FOUND",
              message:
                status === 401 ? "请先登录" : status === 403 ? "没有权限访问该委托" : "委托不存在",
            },
          }),
        });
      });
      const reload = page.getByRole("button", { name: "重新读取状态与回执" });
      if ((await reload.count()) > 0) await reload.first().click();
      else await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const after = await readbackText(page);
      observations[`http${status}`] = { before, after, intercepted: true };
      await tryCheck(`abnormal.${status}.privateCacheCleared`, async () => {
        if (!intercepted) throw new Error("截获未生效");
        const leaked = textHas(after, [/查看复盘记录/, /已归入成果/, /读取于/]);
        if (leaked.length) throw new Error(`私有缓存未清空：${leaked.join(",")}`);
        return { after: sanitize(after, 300), leaked };
      });
      currentCase.viewport = "1280x900";
      currentCase.theme = "light";
      await shot(page, "abnormal", `http-${status}-cache-cleared-1280-light`, record);
    } catch (error) {
      addCheck('case.unexpectedError', 'FAIL', { message: sanitize(error?.message ?? error, 800) });
    } finally {
      await context.close();
      endCase();
    }
  }

  // A5 真实种子：停止在途 / 取消 / UNKNOWN+终态 / 失败 / 来源抑制
  const realStates = [
    {
      key: "stopped",
      title: "停止在途（真实种子）：RUNNING + pauseRequestedAt",
      missionKey: "stopRequested",
      patterns: [/停止/, /结算/],
    },
    {
      key: "cancelled",
      title: "取消（真实种子）：CANCELLED，不显示成功完成",
      missionKey: "cancelled",
      patterns: [/取消/, /保留/],
    },
    {
      key: "terminal-unknown",
      title: "UNKNOWN + 终态（真实种子）：终态与未结算效果并列",
      missionKey: "terminalUnknown",
      patterns: [/未知/, /未结算|核对/],
    },
    {
      key: "failed",
      title: "失败（真实种子）：为何停 / 复核原因",
      missionKey: "failed",
      patterns: [/失败/, /原因|恢复/],
    },
    {
      key: "old-question",
      title: "旧问题（真实种子）：历史问题只读，不替换当前问题",
      missionKey: "waitingUser",
      targetKey: "oldQuestion",
      patterns: [/历史问题/, /只读|旧/],
    },
    {
      key: "old-approval",
      title: "旧审批（真实种子）：过期提案不能作为当前批准依据",
      missionKey: "waitingApproval",
      targetKey: "oldApproval",
      patterns: [/EXPIRED|过期/, /提案/],
    },
    {
      key: "long-copy",
      title: "长文案 390（真实种子）：长标题项目 + 长问题",
      missionKey: "longCopy",
      patterns: [/长文案|SYNTHETIC_LONG/],
    },
  ];
  for (const state of realStates) {
    if (!enabled(state.key)) continue;
    const mission = missionOf(identity, state.missionKey);
    const target = state.targetKey
      ? mission.siblingReadTargets?.[state.targetKey] ?? {}
      : mission.readTarget;
    const record = await startCase({
      kind: "abnormal",
      id: state.key,
      title: state.title,
      dataSource: "REAL_ISOLATED_DATABASE",
    });
    const { context, page } = await newPage(browser, record, { width: 1280, height: 900 });
    try {
      await ensureSignedIn(page, identity, record);
      const { readback } = await openMission(page, identity, mission, target);
      const region = await readbackText(page);
      const main = await mainText(page);
      observations[state.key] = { readbackText: region, mainText: main.slice(0, 5000) };
      await tryCheck(`abnormal.${state.key}.visible`, async () => {
        const found = textHas(region || main, state.patterns);
        if (!found.length) throw new Error(`没有找到预期文案：${state.patterns.map(String).join(" | ")}`);
        return found.map(String);
      });
      currentCase.viewport = "1280x900";
      currentCase.theme = "light";
      await shot(page, "abnormal", `${state.key}-1280-light`, record);
      if (state.key === "long-copy" || state.key === "terminal-unknown") {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        await tryCheck(`abnormal.${state.key}.overflow390`, async () => {
          const report = await overflowReport(page);
          if (report.horizontalOverflow) throw new Error(JSON.stringify(report.offenders.slice(0, 3)));
          return report;
        });
        await shot(page, "abnormal", `${state.key}-390-light`, record);
      }
      await tryCheck(`abnormal.${state.key}.requestAudit`, async () => {
        const audit = summarizeRequests(record.requests);
        if (audit.businessWrites.length) throw new Error(JSON.stringify(audit.businessWrites));
        if (audit.externalRequests.length) throw new Error(JSON.stringify(audit.externalRequests));
        return audit;
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(200);
    } catch (error) {
      addCheck('case.unexpectedError', 'FAIL', { message: sanitize(error?.message ?? error, 800) });
    } finally {
      await context.close();
      endCase();
    }
  }
}

// ---------------------------------------------------------------- 收尾
function writeManifest(context) {
  const manifest = {
    schemaVersion: 1,
    track: "C",
    mode: "EV2_WEB_USER_FLOW_EVIDENCE",
    runLabel,
    startedAt: context.startedAt,
    finishedAt: nowIso(),
    command: `node scripts/final-c/capture-web-evidence.mjs --base-url ${baseUrl}${only !== "all" ? ` --only ${only}` : ""}`,
    candidate: context.git,
    environment: {
      worktree: repoRoot,
      baseUrl,
      port: Number(new URL(baseUrl).port || 80),
      databasePath: context.identity.environment.databasePath,
      databaseUrl: context.identity.environment.databaseUrl,
      llmMode: context.identity.environment.llmMode,
      provider: "mock",
      workerStarted: false,
      themeImplementation: "next-themes attribute=class（html.dark），通过 localStorage.theme 切换并校验 html.dark",
      dataSources: {
        REAL_ISOLATED_DATABASE: "本工作树隔离 SQLite prisma/final-preparation.db 的真实种子状态",
        INTERCEPTED_A2_SAMPLE:
          "evidence/final-a/20261103/samples/a2/a2-legacy-server-without-workpacket.json 的 readback（截获真实 A 样本，非真实旧后端）",
        REAL_RESPONSE_MUTATED: "真实隔离库响应 + Playwright route 注入字段（标注为截获变体）",
        INTERCEPTED_RESPONSE: "Playwright route 截获的异常状态响应",
      },
    },
    fixtureIdentity: {
      path: path.relative(repoRoot, identityPath).replaceAll("\\", "/"),
      account: context.identity.account.username,
      projects: context.identity.projects,
      missions: Object.fromEntries(
        context.identity.missions.map((mission) => [
          mission.key,
          { id: mission.id, projectId: mission.projectId, status: mission.status },
        ]),
      ),
      receiptIdentity: observations.results?.identity ?? null,
      actualReceiptHrefs: observations.results?.actualHrefs ?? null,
      answeredQuestion: observations.answeredQuestion ?? null,
    },
    requestAudit: (() => {
      const entriesOf = (key) =>
        cases.flatMap((row) =>
          (row.requestAudit?.[key] ?? []).map((entry) => ({ case: row.id, entry })),
        );
      const classify = (entry) => {
        const [method, url] = String(entry).split(" ");
        let pathname = "";
        try {
          pathname = new URL(url).pathname;
        } catch {
          /* 保留原始 entry 文本 */
        }
        if (method === "POST" && /\/api\/missions\/[^/]+\/input$/.test(pathname)) {
          return {
            classification: "EXPECTED_TEST_WRITE",
            reason:
              "主线“执行一项原操作（回答原问题）”的真实提交，只写本工作树隔离库；不属于读取页违规写。",
            codeRef: "components/MissionPanel.tsx command('input') → app/api/missions/[id]/input/route.ts",
          };
        }
        return {
          classification: "UNEXPECTED_C_INTERACTION_WRITE",
          reason: "读取页或 C1/C2/C3 交互不应触发的业务写。",
          codeRef: null,
        };
      };
      const groupByEndpoint = (rows) => {
        const map = new Map();
        for (const row of rows) {
          const url = String(row.entry).split(" ")[1] ?? row.entry;
          const key = row.entry.split(" ")[0] + " " + (url.replace(/\/api\/projects\/[^/]+/g, "/api/projects/{id}"));
          map.set(key, (map.get(key) ?? 0) + 1);
        }
        return [...map.entries()].map(([endpoint, count]) => ({ endpoint, count }));
      };
      const business = entriesOf("businessWrites").map((row) => ({ ...row, ...classify(row.entry) }));
      const expectedTestWrites = business.filter((row) => row.classification === "EXPECTED_TEST_WRITE");
      const unexpected = business.filter((row) => row.classification === "UNEXPECTED_C_INTERACTION_WRITE");
      const componentPosts = entriesOf("pageComponentPosts");
      const internalPosts = entriesOf("pageInternalPosts");
      return {
        policy:
          "读取页自身不得因 C1/C2/C3 功能交互产生业务写；既有页面自动 POST 与主线测试写分开归类，不混算。",
        expectedTestWrites: {
          count: expectedTestWrites.length,
          entries: expectedTestWrites,
          note: "主线执行一项原操作的真实提交；只写隔离库，保留回执身份（requestId/questionId/expectedVersion）。",
        },
        cInteractionBusinessWrites: {
          count: unexpected.length,
          entries: unexpected,
          assertion: "必须为 0",
        },
        preExistingPageBehavior: {
          classification: "PRE_EXISTING_PAGE_BEHAVIOR",
          count: componentPosts.length + internalPosts.length,
          pageComponentPosts: {
            endpoints: groupByEndpoint(componentPosts),
            entries: componentPosts,
            codeRefs: [
              "components/GoalQuestion.tsx：挂载 useEffect 先 GET /api/projects/{id}/goal-question，再 POST PRESENT；曝光的 IntersectionObserver 再 POST EXPOSED（既有遥测回执，非 Mission 业务命令）。",
            ],
          },
          pageInternalPosts: {
            endpoints: groupByEndpoint(internalPosts),
            entries: internalPosts,
            codeRefs: [
              "components/FocusAgentWorkspace.tsx：/focus 挂载 useEffect POST /api/conversations/sync 同步锚点投影（既有页面行为）。",
            ],
          },
        },
        externalRequests: {
          count: entriesOf("externalRequests").length,
          entries: entriesOf("externalRequests"),
          assertion: "必须为 0",
        },
      };
    })(),
    login: loginEvidence,
    findings: [
      ...((cases.flatMap((row) => row.requestAudit?.pageComponentPosts ?? []).length > 0)
        ? [
            {
              id: "F-EV2-PAGE-COMPONENT-POSTS",
              severity: "INFO_RISK",
              title: "读取页仍会触发既有 GoalQuestion 组件与焦点页锚点同步的写请求",
              observed: `pageComponentPosts=${cases.flatMap((row) => row.requestAudit?.pageComponentPosts ?? []).length} 次（POST /api/projects/{id}/goal-question 的 PRESENT/EXPOSED 回执）；pageInternalPosts=${cases.flatMap((row) => row.requestAudit?.pageInternalPosts ?? []).length} 次（POST /api/conversations/sync）。`,
              expected:
                "合同严格要求读取页只 GET；这些写不是 Mission 业务命令、也不改委托状态，但严格口径下仍是写请求。",
              classification:
                "PRE_EXISTING_PAGE_BEHAVIOR：GoalQuestion 与 FocusAgentWorkspace 挂载行为，不属于 C1/C2/C3 本轮新增；未在本次修复（不改产品源码），由 Lead 裁决例外或后续修复。",
              evidence:
                "logs/requests-*.json 的 pageComponentPosts/pageInternalPosts；components/GoalQuestion.tsx、components/FocusAgentWorkspace.tsx",
            },
          ]
        : []),
    ],
    modelCalls: {
      measuredFromBrowser: false,
      declaredProvider: "mock",
      reason:
        "浏览器网络只能证明前端请求；服务端到模型 provider 的流量未单独仪表化。本环境 LLM_MODE=mock、未配置真实模型密钥，且浏览器请求中无外部域，故不宣称实模调用；如需服务端证据请参见 server 日志与 AgentRun 记录。",
    },
    cases,
    checks,
    totals: {
      checks: checks.length,
      pass: checks.filter((check) => check.status === "PASS").length,
      fail: checks.filter((check) => check.status === "FAIL").length,
      notRun: checks.filter((check) => check.status === "NOT_RUN").length,
    },
    screenshots: cases.flatMap((row) => row.screenshots),
    observations,
    limitations: [
      "旧后端缺 workPacket 是 A2 真实序列化样本的截获响应，不是真实旧后端实例。",
      "VERSION_ADVANCED 与 409/401/403/404 是 Playwright route 截获变体，不是真实并发/真实权限变化。",
      "浏览器无法证明服务端到 provider 的模型调用数；本环境为 mock。",
      "未测试 Worker 执行、真实模型质量、真实用户数据与生产部署。",
    ],
  };
  // 全局请求审计断言（在 totals 之前追加，失败会进入 FAIL 计数）。
  checks.push({
    case: "global",
    id: "audit.cInteractionBusinessWritesZero",
    status: manifest.requestAudit.cInteractionBusinessWrites.count === 0 ? "PASS" : "FAIL",
    detail: {
      expected: 0,
      observed: manifest.requestAudit.cInteractionBusinessWrites.count,
      entries: manifest.requestAudit.cInteractionBusinessWrites.entries,
    },
    at: nowIso(),
  });
  checks.push({
    case: "global",
    id: "audit.externalRequestsZero",
    status: manifest.requestAudit.externalRequests.count === 0 ? "PASS" : "FAIL",
    detail: manifest.requestAudit.externalRequests,
    at: nowIso(),
  });
  checks.push({
    case: "global",
    id: "audit.preExistingPageBehaviorClassified",
    status: "PASS",
    detail: {
      classification: manifest.requestAudit.preExistingPageBehavior.classification,
      count: manifest.requestAudit.preExistingPageBehavior.count,
      note: "既有 GoalQuestion / FocusAgentWorkspace 挂载写请求，单列并在 notes 说明；不计入 C 功能交互业务写。",
    },
    at: nowIso(),
  });
  manifest.checks = checks;
  manifest.totals = {
    checks: checks.length,
    pass: checks.filter((check) => check.status === "PASS").length,
    fail: checks.filter((check) => check.status === "FAIL").length,
    notRun: checks.filter((check) => check.status === "NOT_RUN").length,
  };
  manifest.evidenceMethod = {
    screenshots:
      "所有应当展示工作包的截图前，显式等待 [data-mission-primary-action] 与“做到哪”可见；主题切换 reload 后重新等待，再重开依据 details 并等待“逐项依据与原文”；不以 reload 后立即截图。",
    basisScope:
      "依据截图在“逐项依据与原文”区域展开后拍摄；被抑制来源另拍元素级截图，要求“当前使用资格=当前许可已被撤回”和“修订状态=原修订匹配”两行同时可见。",
    readbackVariants:
      "VERSION_ADVANCED 用 Playwright route 对本会话所有 readback 响应生效并记录每次拦截体；409/401/403/404 为截获响应；旧后端缺 workPacket 使用 A2 真实序列化样本回填 readback，页面其它区域仍显示未截获的 /api/missions/:id 原详情真实事实。",
    requestClassification:
      "EXPECTED_TEST_WRITE（主线回答原问题，只写隔离库）/ PRE_EXISTING_PAGE_BEHAVIOR（GoalQuestion、FocusAgentWorkspace 挂载写）/ UNEXPECTED_C_INTERACTION_WRITE（应当为 0）/ externalRequests（应当为 0）。",
    iterations: [
      "iteration-1（候选 5b89ecf/e9f8be1 期间）：64 检查 / 60 PASS / 4 FAIL；失败为 goal-question 既有 POST 归类、legacy 断言跨区域、VERSION_ADVANCED 读取时机。日志保留 logs/capture-web-iteration1.log。",
      "iteration-2（候选 21cb961 期间）：64 检查 / 62 PASS / 2 FAIL；legacy 误把“已独立支持”分类标签当成功语义、401 首次读取未等工作包渲染。日志保留 logs/capture-web-iteration2.log。",
      `本次（${runLabel}，候选 ${context.git.shortSha}）：命令与退出码见 manifest.exitCode；fail=${manifest.totals.fail}。`,
    ],
  };
  manifest.exitCode = manifest.totals.fail === 0 ? 0 : 1;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const lines = [
    "# Track C Web 证据说明（EV2）",
    "",
    `- 生成时间：${manifest.startedAt} → ${manifest.finishedAt}`,
    `- 候选：${manifest.candidate.branch} @ ${manifest.candidate.shortSha}（dirty=${manifest.candidate.dirty}）`,
    `- 环境：${baseUrl} · 隔离库 ${manifest.environment.databasePath} · provider=mock · 无 Worker`,
    `- fixture 身份：\`${manifest.fixtureIdentity.path}\``,
    "",
    "## 检查汇总",
    `- 检查：${manifest.totals.checks}，PASS ${manifest.totals.pass}，FAIL ${manifest.totals.fail}，NOT_RUN ${manifest.totals.notRun}`,
    `- 退出码：${manifest.exitCode}`,
    "",
    "## 用例",
    ...cases.map(
      (row) =>
        `- ${row.id} · ${row.title} · ${row.dataSource} · 截图 ${row.screenshots.length} 张\n  - request audit：业务写 ${row.requestAudit?.businessWrites?.length ?? 0}，页面内部 POST ${row.requestAudit?.pageInternalPosts?.length ?? 0}，外部域 ${row.requestAudit?.externalRequests?.length ?? 0}`,
    ),
    "",
    "## 失败检查",
    ...(manifest.totals.fail
      ? checks
          .filter((check) => check.status === "FAIL")
          .map((check) => `- [${check.case}] ${check.id}：${JSON.stringify(check.detail)}`)
      : ["（无）"]),
    "",
    "## 发现（不修改产品源码，交 Lead 裁决）",
    ...(manifest.findings.length
      ? manifest.findings.map(
          (finding) =>
            `- ${finding.id}（${finding.severity}）${finding.title}\n  - 观察：${finding.observed}\n  - 期望：${finding.expected}\n  - 分类：${finding.classification}\n  - 证据：${finding.evidence}`,
        )
      : ["（无）"]),
    "",
    "## 实际回执身份",
    "```json",
    JSON.stringify(
      {
        receiptIdentity: manifest.fixtureIdentity.receiptIdentity,
        actualReceiptHrefs: manifest.fixtureIdentity.actualReceiptHrefs,
        answeredQuestion: manifest.fixtureIdentity.answeredQuestion,
      },
      null,
      2,
    ),
    "```",
    "",
    "## 请求审计分类",
    `- EXPECTED_TEST_WRITE（主线回答原问题，只写隔离库）：${manifest.requestAudit.expectedTestWrites.count} 次`,
    `- UNEXPECTED_C_INTERACTION_WRITE（读取页违规业务写，必须为 0）：${manifest.requestAudit.cInteractionBusinessWrites.count} 次`,
    `- PRE_EXISTING_PAGE_BEHAVIOR（既有页面自动写，单列不计违规）：${manifest.requestAudit.preExistingPageBehavior.count} 次`,
    `  - POST /api/projects/{id}/goal-question：${manifest.requestAudit.preExistingPageBehavior.pageComponentPosts.endpoints.map((row) => row.endpoint + "×" + row.count).join("、") || "0"}`,
    `  - POST /api/conversations/sync：${manifest.requestAudit.preExistingPageBehavior.pageInternalPosts.endpoints.map((row) => row.endpoint + "×" + row.count).join("、") || "0"}`,
    `  - 依据：components/GoalQuestion.tsx 挂载 PRESENT/EXPOSED 回执；components/FocusAgentWorkspace.tsx 挂载锚点同步。`,
    `- 外部域请求（必须为 0）：${manifest.requestAudit.externalRequests.count} 次`,
    "",
    "## 证据方法和限制",
    ...Object.entries(manifest.evidenceMethod)
      .filter(([key]) => key !== "iterations")
      .map(([key, value]) => `- ${key}：${value}`),
    ...manifest.evidenceMethod.iterations.map((line) => `- 迭代记录：${line}`),
    "",
    "## 数据来源与限制",
    "- REAL_ISOLATED_DATABASE：真实隔离库种子状态（真实服务读回，不是截获）。",
    "- INTERCEPTED_A2_SAMPLE：旧后端缺 workPacket 使用 A2 真实 JSON 样本 readback 截获，已标注非真实旧后端。",
    "- REAL_RESPONSE_MUTATED / INTERCEPTED_RESPONSE：VERSION_ADVANCED、409、401/403/404 为截获变体。",
    "- 浏览器无法证明服务端到 provider 的模型调用数；本环境 LLM_MODE=mock。",
    ...manifest.limitations.map((item) => `- ${item}`),
    "",
  ];
  fs.writeFileSync(notesPath, `${lines.join("\n")}\n`, "utf8");
  return manifest;
}

async function main() {
  const startedAt = nowIso();
  const git = gitFacts();
  if (probeOnly) {
    const { browser, chromium } = await launch();
    try {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "BROWSER_PROBE_ONLY",
            playwright: "available",
            chromiumVersion: browser.version(),
            executablePath: chromium.executablePath(),
            launchHeadless: true,
            checkedAt: nowIso(),
          },
          null,
          2,
        ),
      );
    } finally {
      await browser.close();
    }
    return 0;
  }
  const identity = readIdentity();
  if (identity.exitCode !== 0) throw new Error("fixture-identity.json 记录 seed 失败，拒绝采集");
  // 健康检查：服务未启动时明确退出 2，不产生假证据。
  const health = await fetch(`${baseUrl}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error(
      `[capture] 服务不可用：${baseUrl}/health；请先运行 tmp/final-preparation/Start-Track.ps1（端口 34112）。`,
    );
    return 2;
  }
  const { browser } = await launch();
  const context = { startedAt, git, identity, baseUrl, only, filter, mode };
  try {
    if (only === "all" || only === "normal") {
      try {
        await runNormal(browser, identity);
      } catch (error) {
        addCheck("runNormal.unexpectedError", "FAIL", {
          message: sanitize(error?.message ?? error, 800),
        });
      }
    }
    if (only === "all" || only === "abnormal") {
      try {
        await runAbnormal(browser, identity);
      } catch (error) {
        addCheck("runAbnormal.unexpectedError", "FAIL", {
          message: sanitize(error?.message ?? error, 800),
        });
      }
    }
  } finally {
    await browser.close();
  }
  const manifest = writeManifest(context);
  console.log(
    JSON.stringify(
      {
        ok: manifest.totals.fail === 0,
        manifestPath,
        notesPath,
        totals: manifest.totals,
        failures: checks.filter((check) => check.status === "FAIL").slice(0, 20),
      },
      null,
      2,
    ),
  );
  return manifest.totals.fail === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("[capture] 失败：", error);
    process.exitCode = 1;
  });
