import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicHost, browserTestOrigins, browserUrl, isPublicAddress } from "@/lib/browser/policy";

afterEach(() => vi.unstubAllEnvs());

describe("隔离浏览器网络策略", () => {
  it.each(["http://example.org/a", "https://127.0.0.1/a", "https://[::1]/a", "https://169.254.169.254/latest/meta-data",
    "https://user:pass@example.org/a", "https://localhost/a", "https://foo.internal/a", "https://example.org:8443/a",
    "https://example.org/a?token=secret", "file:///C:/secret.txt", "data:text/html,hi"])("拒绝 %s", raw => {
    expect(() => browserUrl(raw, { allowedHosts: [] })).toThrow();
  });
  it("按授权域名与协议规范化，并去掉片段", () => {
    expect(browserUrl("https://example.org/a#top", { allowedHosts: ["example.org"] }).url).toBe("https://example.org/a");
    expect(() => browserUrl("https://other.org/a", { allowedHosts: ["example.org"] })).toThrow();
    expect(browserUrl("https://other.org/a", { allowedHosts: [] }).hostname).toBe("other.org");
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700::1111", "2a00:1450::1"])("公开地址 %s", address => expect(isPublicAddress(address)).toBe(true));
  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1",
    "0.0.0.0", "224.0.0.1", "::1", "::", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "fc00::1", "fd00::1", "fe80::1",
    "ff00::1", "2001:db8::1", "64:ff9b::7f00:1", "2002:7f00:1::"])("私有或保留地址 %s", address => expect(isPublicAddress(address)).toBe(false));
  it("DNS 任一私有或混合结果都拒绝", async () => {
    await expect(assertPublicHost("example.org", { test: false, resolve: async () => ["93.184.216.34"] })).resolves.toHaveLength(1);
    await expect(assertPublicHost("example.org", { test: false, resolve: async () => ["127.0.0.1"] })).rejects.toMatchObject({ code: "BROWSER_PRIVATE_ADDRESS" });
    await expect(assertPublicHost("example.org", { test: false, resolve: async () => ["93.184.216.34", "10.0.0.1"] })).rejects.toMatchObject({ code: "BROWSER_PRIVATE_ADDRESS" });
    await expect(assertPublicHost("example.org", { test: false, resolve: async () => [] })).rejects.toMatchObject({ code: "BROWSER_DNS_FAILED" });
  });
  it("测试环回来源只在 Vitest 且显式配置时生效，其它地址不能借道", () => {
    vi.stubEnv("BROWSER_TEST_ALLOW_ORIGINS", "http://127.0.0.1:55001,http://169.254.169.254:80,https://example.org");
    const origins = browserTestOrigins();
    expect(origins.map(origin => origin.origin)).toEqual(["http://127.0.0.1:55001"]);
    expect(browserUrl("http://127.0.0.1:55001/page", { allowedHosts: [], testOrigins: origins }).test).toBe(true);
    expect(() => browserUrl("http://127.0.0.1:55002/page", { allowedHosts: [], testOrigins: origins })).toThrow();
  });
});
