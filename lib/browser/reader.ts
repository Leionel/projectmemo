import {readBrowserResource} from "./transport";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { assertPublicHost, browserTestOrigins, browserUrl, type BrowserTestOrigin } from "./policy";
import {
  DEFAULT_BROWSER_LIMITS, browserObservationSchema, type BrowserObservation, type BrowserReadRequest, type BrowserReader,
} from "./contracts";

type PlaywrightModule = typeof import("playwright-core");
const requireFromProject = createRequire(process.cwd() + "/package.json");

export function browserRuntimeInfo() {
  if (!isFeatureEnabled("BROWSER_READ_ENABLED", false)) return { available: false, reason: "BROWSER_READ_DISABLED" };
  try {
    const { chromium } = requireFromProject("playwright-core") as PlaywrightModule;
    const executable = process.env.BROWSER_CHROMIUM_EXECUTABLE?.trim() || chromium.executablePath();
    if (!executable || !existsSync(executable)) return { available: false, reason: "BROWSER_EXECUTABLE_MISSING" };
    return { available: true, reason: "", executable };
  } catch { return { available: false, reason: "BROWSER_RUNTIME_MISSING" }; }
}
export const browserReadAvailable = () => browserRuntimeInfo().available;

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const safeMessage = (code: string) => ({
  BROWSER_EMPTY: "页面没有可见正文", BROWSER_URL_BLOCKED: "页面导航或子请求超出公开读取策略",
  BROWSER_NAVIGATION_TIMEOUT: "页面在时限内未完成加载，只保留已见正文", BROWSER_NAVIGATION_FAILED: "页面未能打开",
  BROWSER_PARTIAL_RENDER: "页面仍在异步加载，只保留已见正文", BROWSER_BUDGET_EXCEEDED: "页面请求超出本次读取预算",
  BROWSER_FINAL_URL_BLOCKED: "页面跳转到未获准地址，已停止读取", BROWSER_RUNTIME_MISSING: "隔离浏览器运行时不可用",
} as Record<string, string>)[code] ?? "隔离浏览器未取得结果";

function bounded<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener("abort",abort,{once:true});pending.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));});
}

function normalizeText(value: string) { return value.normalize("NFKC").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim(); }

/**
 * Playwright/Chromium reader. The browser starts with no profile, cookies or storage state.
 * Every request is routed through the same URL/DNS policy; redirects, iframes and subresources
 * cannot bypass it because each one is a new intercepted request.
 */
class IsolatedChromiumReader implements BrowserReader {
  name = "isolated-chromium";
  async read(request: BrowserReadRequest, options: { signal: AbortSignal; beforeRequest?:()=>Promise<void> }): Promise<BrowserObservation> {
    const runtime = browserRuntimeInfo();
    if (!runtime.available) throw new AppError(runtime.reason, "隔离浏览器读取当前不可用", 503);
    if (options.signal.aborted) throw new AppError("BROWSER_ABORTED", "本轮读取已停止", 409);
    const { chromium } = requireFromProject("playwright-core") as PlaywrightModule;
    const limits = { ...DEFAULT_BROWSER_LIMITS, ...request.limits };
    const deadline = AbortSignal.timeout(limits.maxRenderMs);
    const budgetAbort=new AbortController();
    const signal=AbortSignal.any([options.signal,deadline,budgetAbort.signal]);
    const scrolls = Math.max(0, Math.min(request.scrolls, limits.maxScrolls));
    const started = Date.now(), observedAt = new Date().toISOString();
    const testOrigins: BrowserTestOrigin[] = browserTestOrigins();
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    let page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>> | null = null;
    let requests = 0, blockedRequests = 0, bytes = 0, overBudget = false, navigationBlocked: string | null = null, performedScrolls = 0;
    let pendingRedirect:string|null=null,redirects=0;
    let navigationError: { timeout: boolean } | null = null;
    const close = async () => { await browser?.close().catch(() => undefined); };
    const abort = () => { void close(); };
    signal.addEventListener("abort", abort, { once: true });
    const hostCache = new Map<string, Promise<string[]>>();
    try {
      browser = await chromium.launch({ headless: true, executablePath: runtime.executable, timeout: 15000,
        args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-background-networking", "--disable-extensions", "--disable-sync", "--no-first-run", "--mute-audio", "--disable-dev-shm-usage"] });
      const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", javaScriptEnabled: true,
        locale: "zh-CN", viewport: { width: 1280, height: 900 }, storageState: undefined, ignoreHTTPSErrors: false });
      await context.addInitScript(()=>{for(const name of ["RTCPeerConnection","webkitRTCPeerConnection","WebTransport","WebSocket"])Object.defineProperty(globalThis,name,{value:undefined,configurable:false,writable:false});});
      page = await context.newPage();
      context.on("page", popup => { if (popup !== page) { blockedRequests++; void popup.close().catch(() => undefined); } });
      page.on("dialog", dialog => { void dialog.dismiss().catch(() => undefined); });
      page.on("download", download => { blockedRequests++; void download.cancel().catch(() => undefined); });
      page.on("requestfailed", failed => {
        if (!failed.isNavigationRequest()) return;
        let mainFrame = true;
        try { mainFrame = failed.frame() === page!.mainFrame(); } catch { mainFrame = true; }
        if (!mainFrame) return;
        try { browserUrl(failed.url(), { allowedHosts: request.allowedHosts, testOrigins }); }
        catch { blockedRequests++; navigationBlocked = "BROWSER_URL_BLOCKED"; }
      });
      await context.route("**/*", async route => {
        const intercepted = route.request();
        requests++;
        let topLevel = false;
        try { topLevel = intercepted.frame() === page!.mainFrame(); }
        catch { topLevel = intercepted.isNavigationRequest(); }
        if (requests > limits.maxRequests || overBudget) { blockedRequests++; overBudget = true; if (topLevel && intercepted.isNavigationRequest()) navigationBlocked = "BROWSER_URL_BLOCKED"; return route.abort("blockedbyclient").catch(() => undefined); }
        const method = intercepted.method().toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
          blockedRequests++; if (topLevel && intercepted.isNavigationRequest()) navigationBlocked = "BROWSER_URL_BLOCKED";
          return route.abort("blockedbyclient").catch(() => undefined);
        }
        let target: ReturnType<typeof browserUrl>;
        try { target = browserUrl(intercepted.url(), { allowedHosts: request.allowedHosts, testOrigins }); }
        catch {
          blockedRequests++; if (topLevel && intercepted.isNavigationRequest()) navigationBlocked = "BROWSER_URL_BLOCKED";
          return route.abort("blockedbyclient").catch(() => undefined);
        }
        try {
          const addresses = hostCache.get(target.hostname) ?? assertPublicHost(target.hostname, { test: target.test });
          hostCache.set(target.hostname, addresses);
          await bounded(addresses,signal);
        } catch {
          blockedRequests++; if (topLevel && intercepted.isNavigationRequest()) navigationBlocked = "BROWSER_URL_BLOCKED";
          return route.abort("blockedbyclient").catch(() => undefined);
        }
        try {
          let resource=target;
          for(let hop=0;hop<6;hop++){
            const addresses=await bounded(hostCache.get(resource.hostname)!,signal);
            await options.beforeRequest?.();signal.throwIfAborted();
            const result=await readBrowserResource(resource.url,addresses,signal,size=>{
              bytes+=size;if(bytes>limits.maxBytes){overBudget=true;budgetAbort.abort(new AppError("BROWSER_BUDGET_EXCEEDED","网页正文超过累计读取预算",409));throw new AppError("BROWSER_BUDGET_EXCEEDED","网页正文超过累计读取预算",409);}
            });
            if([301,302,303,307,308].includes(result.status)){
              if(!result.headers.location)throw new Error("redirect without location");
              const next=browserUrl(new URL(result.headers.location,resource.url).href,{allowedHosts:request.allowedHosts,testOrigins});
              const resolved=hostCache.get(next.hostname)??assertPublicHost(next.hostname,{test:next.test});hostCache.set(next.hostname,resolved);await bounded(resolved,signal);
              if(topLevel&&intercepted.isNavigationRequest()){pendingRedirect=next.url;return route.abort("blockedbyclient").catch(()=>undefined);}
              if(++requests>limits.maxRequests){overBudget=true;throw new Error("redirect budget");}resource=next;continue;
            }
            return route.fulfill({status:result.status,headers:result.headers,body:result.body}).catch(()=>undefined);
          }
          throw new Error("redirect limit");
        }catch{
          blockedRequests++;if(topLevel&&intercepted.isNavigationRequest())navigationBlocked="BROWSER_URL_BLOCKED";
          return route.abort("blockedbyclient").catch(()=>undefined);
        }
      });
      const webSocket = (page as unknown as { routeWebSocket?: (pattern: RegExp, handler: (socket: { close: () => Promise<void> | void }) => void) => Promise<void> }).routeWebSocket;
      if (webSocket) await webSocket.call(page, /.*/, socket => { blockedRequests++; void socket.close(); }).catch(() => undefined);
      const parsed = browserUrl(request.url, { allowedHosts: request.allowedHosts, testOrigins });
      let navigate=parsed.url;
      do {
        pendingRedirect=null;
        try { await page.goto(navigate, { waitUntil: "domcontentloaded", timeout: Math.max(1,limits.maxRenderMs-(Date.now()-started)) }); }
        catch(error){if(!pendingRedirect)navigationError={timeout:signal.aborted||!!(error as {name?:string}).name?.includes("Timeout")};}
        if(pendingRedirect){navigate=pendingRedirect;if(++redirects>5){navigationBlocked="BROWSER_URL_BLOCKED";break;}}
      }while(pendingRedirect&&!signal.aborted);
      if (!overBudget && !navigationBlocked) await page.waitForLoadState("networkidle", { timeout: Math.min(3000, limits.maxRenderMs) }).catch(() => undefined);
      if (request.mode === "READ_DETAILS") {
        try {
          const details = page.locator("details:not([open]) > summary"), count = Math.min(3, await details.count());
          for (let index = 0; index < count; index++) await details.nth(index).click({ timeout: 1500 }).catch(() => undefined);
        } catch { /* Native disclosure only; no other controls are clicked. */ }
      }
      for (let index = 0; index < scrolls; index++) {
        if (overBudget || signal.aborted) break;
        await page.evaluate(() => window.scrollBy(0, window.innerHeight)).catch(() => undefined);
        await page.waitForTimeout(180).catch(() => undefined);
        performedScrolls++;
      }
      const rawText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
      const text = normalizeText(rawText), visibleText = text.slice(0, 8000);
      const headings = await page.locator("h1,h2,h3").evaluateAll(nodes => nodes.filter(node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=="hidden").slice(0, 24).map(node => ({
        level: Math.min(3, Math.max(1, Number(node.tagName.slice(1)) || 1)), text: ((node as HTMLElement).innerText ?? "").trim().slice(0, 200),
      }))).catch(() => [] as Array<{ level: number; text: string }>);
      const title = (await page.title().catch(() => "")) || new URL(parsed.url).hostname;
      const readyRaw = await page.evaluate(() => document.readyState).catch(() => "unknown");
      const readyState = (["loading", "interactive", "complete"].includes(readyRaw) ? readyRaw : "unknown") as BrowserObservation["readyState"];
      const currentUrl = page.url(), finalUrl = /^https?:/i.test(currentUrl) ? currentUrl : parsed.url;
      let finalBlocked = false;
      try { browserUrl(finalUrl, { allowedHosts: request.allowedHosts, testOrigins }); } catch { finalBlocked = true; }
      const screenshot = await page.screenshot({ type: "png", fullPage: false, timeout: 3000 }).catch(() => null);
      const firstHeading = headings.find(heading => heading.text);
      const quote = visibleText.slice(0, 240);
      let status: BrowserObservation["status"] = "RENDERED";
      let failureCode: string | null = null;
      if (overBudget) { status = "PARTIAL"; failureCode = "BROWSER_BUDGET_EXCEEDED"; }
      else if (navigationBlocked || finalBlocked) { status = "BLOCKED"; failureCode = "BROWSER_URL_BLOCKED"; }
      else if (navigationError) { status = navigationError.timeout ? "PARTIAL" : "FAILED"; failureCode = navigationError.timeout ? "BROWSER_NAVIGATION_TIMEOUT" : "BROWSER_NAVIGATION_FAILED"; }
      else if (!visibleText) { status = "EMPTY"; failureCode = "BROWSER_EMPTY"; }
      else if (overBudget) { status = "PARTIAL"; failureCode = "BROWSER_BUDGET_EXCEEDED"; }
      else if (readyState !== "complete") { status = "PARTIAL"; failureCode = "BROWSER_PARTIAL_RENDER"; }
      return browserObservationSchema.parse({
        status, requestedUrl: parsed.url, finalUrl, title: title.slice(0, 300), observedAt,
        renderMs: Date.now() - started, readyState, mode: request.mode, visibleText,
        headings: headings.filter(heading => heading.text) as BrowserObservation["headings"],
        locator: { selector: "body", headingPath: firstHeading ? [firstHeading.text] : [], quote, start: 0, end: quote.length, textHash: hash(text) },
        coverage: { complete: status === "RENDERED", visibleCharacters: visibleText.length, totalCharacters: text.length, truncated: text.length > visibleText.length,
          scrolls: performedScrolls, pages: 1, requests, blockedRequests, bytes },
        screenshotHash: screenshot ? hash(screenshot) : null,
        failure: failureCode ? { code: failureCode, message: safeMessage(failureCode) } : null,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("BROWSER_FAILED", safeMessage("BROWSER_FAILED"), 503);
    } finally {
      signal.removeEventListener("abort", abort);
      await close();
    }
  }
}

export const isolatedBrowserReader: BrowserReader = new IsolatedChromiumReader();
