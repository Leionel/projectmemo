import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { AppError } from "@/lib/api";

export type BrowserTestOrigin = { origin: string; hostname: string; port: string; protocol: string };

const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
function normalizeHost(raw: string) {
  return raw.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** Test-only exact origins, restricted to loopback and enabled only under Vitest. Production policies ignore this variable. */
export function browserTestOrigins(): BrowserTestOrigin[] {
  if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") return [];
  return (process.env.BROWSER_TEST_ALLOW_ORIGINS ?? "").split(",").flatMap(raw => {
    const value = raw.trim();
    if (!value) return [];
    try {
      const url = new URL(value), hostname = normalizeHost(url.hostname);
      if (!["http:", "https:"].includes(url.protocol) || !loopbackHosts.has(hostname) || url.pathname !== "/" || url.search || url.hash) return [];
      return [{ origin: url.origin, hostname, port: url.port, protocol: url.protocol }];
    } catch { return []; }
  });
}

function ipv4ToInt(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function expandIpv6(address: string): number[] | null {
  let value = address.split("%")[0].toLowerCase();
  const embedded = value.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded) {
    const v4 = ipv4ToInt(embedded[1]); if (v4 === null) return null;
    const groups = [Math.floor(v4 / 65536), v4 % 65536];
    value = value.slice(0, -embedded[1].length);
    value = value.endsWith(":") ? `${value}${groups[0].toString(16)}:${groups[1].toString(16)}` : `${value}${groups[0].toString(16)}:${groups[1].toString(16)}`;
  }
  const compressed = value.includes("::");
  if (compressed && value.split("::").length > 2) return null;
  const [head, tail] = compressed ? value.split("::") : [value, ""];
  const left = head ? head.split(":") : [], right = tail ? tail.split(":") : [];
  const filler = compressed ? 8 - left.length - right.length : 0;
  if (filler < 0 || (!compressed && (left.length !== 8 || right.length))) return null;
  const groups = [...left, ...Array(filler).fill("0"), ...right].map(part => parseInt(part || "0", 16));
  return groups.length === 8 && groups.every(group => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

/** Resolves mapped addresses before deciding; every resolved address must be public. */
export function isPublicAddress(raw: string): boolean {
  const address = raw.trim().toLowerCase();
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToInt(address);
    if (value === null) return false;
    return !(
      (value >>> 24) === 0 || (value >>> 24) === 10 || (value >>> 24) === 127 ||
      (value >= ipv4ToInt("100.64.0.0")! && value <= ipv4ToInt("100.127.255.255")!) ||
      (value >= ipv4ToInt("169.254.0.0")! && value <= ipv4ToInt("169.254.255.255")!) ||
      (value >= ipv4ToInt("172.16.0.0")! && value <= ipv4ToInt("172.31.255.255")!) ||
      (value >= ipv4ToInt("192.0.0.0")! && value <= ipv4ToInt("192.0.2.255")!) ||
      (value >= ipv4ToInt("192.88.99.0")! && value <= ipv4ToInt("192.88.99.255")!) ||
      (value >= ipv4ToInt("192.168.0.0")! && value <= ipv4ToInt("192.168.255.255")!) ||
      (value >= ipv4ToInt("198.18.0.0")! && value <= ipv4ToInt("198.19.255.255")!) ||
      (value >= ipv4ToInt("198.51.100.0")! && value <= ipv4ToInt("198.51.100.255")!) ||
      (value >= ipv4ToInt("203.0.113.0")! && value <= ipv4ToInt("203.0.113.255")!) ||
      (value >= ipv4ToInt("224.0.0.0")! && value <= ipv4ToInt("255.255.255.255")!)
    );
  }
  if (family !== 6) return false;
  const groups = expandIpv6(address); if (!groups) return false;
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    const value = ((groups[6] << 16) | groups[7]) >>> 0;
    return isPublicAddress(`${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`);
  }
  const first = groups[0];
  if (first === 0x0000 && groups.every((group, index) => index === 7 ? group <= 1 : group === 0)) return false; // ::/128 and ::1
  if (first >= 0xfc00 && first <= 0xfdff) return false; // fc00::/7
  if (first >= 0xfe80 && first <= 0xfebf) return false; // fe80::/10
  if (first >= 0xff00) return false; // ff00::/8
  if (first === 0x2001 && groups[1] === 0x0db8) return false; // 2001:db8::/32
  if (first === 0x2002) return false; // 6to4 embeds an arbitrary IPv4 target
  if (first === 0x0064 && groups[1] === 0xff9b) return false; // NAT64 can map loopback/private IPv4
  if (first === 0x2001 && (groups[1] === 0x0000 || groups[1] === 0x0010 || groups[1] === 0x0020)) return false; // Teredo/ORCHID
  if(first===0x2001&&groups[1]<0x0200)return false;
  if(first===0x3fff&&groups[1]<0x1000)return false;
  return first>=0x2000&&first<=0x3fff;
}

/**
 * Normalizes and checks one browser URL. This is used for the top-level page, redirects,
 * iframes and every subresource; a subrequest is never trusted because the root URL passed.
 */
export function browserUrl(raw: string, options: { allowedHosts: string[]; testOrigins?: BrowserTestOrigin[] }) {
  const value = String(raw).trim();
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError("UNSAFE_URL", "资料链接格式无效", 422); }
  url.hash = "";
  const hostname = normalizeHost(url.hostname);
  const test = (options.testOrigins ?? []).find(origin => origin.origin === url.origin);
  if (!test) {
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || isIP(hostname) ||
      !hostname.includes(".") || /(^|\.)(localhost|local|internal|test|invalid)$/.test(hostname) || hostname.endsWith(".local") ||
      hostname.endsWith(".internal") || value.length > 8192)
      throw new AppError("UNSAFE_URL", "只能读取公开 HTTPS 资料链接", 422);
  }
  if (options.allowedHosts.length && !options.allowedHosts.some(host => hostname === normalizeHost(host)))
    throw new AppError("URL_OUT_OF_SCOPE", "资料域名超出授权范围", 409);
  if ([...url.searchParams.keys()].some(key => /token|secret|signature|password|authorization|api.?key|session|x-amz|access.?key/i.test(key)) ||
    /(?:sk-[a-z0-9]{16,}|\/(?:private|login|signin|share)(?:\/|$))/i.test(url.pathname))
    throw new AppError("URL_SENSITIVE", "链接可能包含私有分享或登录信息，只能读取公开页面", 409);
  return { url: url.href, hostname, test: !!test };
}

/** Resolves every address for a host once per observation and rejects mixed public/private DNS answers. */
export async function assertPublicHost(hostname: string, options: { test: boolean; resolve?: (host: string) => Promise<string[]> }) {
  if (options.test) return ["127.0.0.1"];
  let addresses: string[];
  try {
    addresses = options.resolve ? await options.resolve(hostname) : (await lookup(hostname, { all: true, verbatim: true })).map(row => row.address);
  } catch { throw new AppError("BROWSER_DNS_FAILED", "无法解析该网页域名", 422); }
  if (!addresses.length) throw new AppError("BROWSER_DNS_FAILED", "无法解析该网页域名", 422);
  if (addresses.some(address => !isPublicAddress(address)))
    throw new AppError("BROWSER_PRIVATE_ADDRESS", "该网页解析到私有地址，已阻止读取", 422);
  return addresses;
}
