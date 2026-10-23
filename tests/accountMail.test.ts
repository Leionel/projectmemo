import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { accountMailConfiguration, sendAccountMail } from "@/lib/auth/mail";

beforeEach(() => {
  vi.stubEnv("AUTH_MAIL_TRANSPORT", "resend");
  vi.stubEnv("AUTH_PUBLIC_BASE_URL", "https://project.luojiatutor.xyz");
  vi.stubEnv("AUTH_EMAIL_FROM", "忆程 <no-reply@mail.luojiatutor.xyz>");
  vi.stubEnv("RESEND_API_KEY", "fixture-not-a-real-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("Account mail transport", () => {
  it("uses fixed Resend HTTPS endpoint, server credential, approved sender and per-token idempotency", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ id: "test-message-id" }));
    await sendAccountMail({
      to: "recipient@example.test",
      subject: "测试",
      text: "测试正文",
      idempotencyKey: "account-token/test-id",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options?.redirect).toBe("error");
    expect(options?.headers).toMatchObject({
      Authorization: "Bearer fixture-not-a-real-key",
      "Idempotency-Key": "account-token/test-id",
    });
    expect(JSON.parse(String(options?.body))).toEqual({
      from: "忆程 <no-reply@mail.luojiatutor.xyz>",
      to: ["recipient@example.test"],
      subject: "测试",
      text: "测试正文",
    });
  });
  it.each([401, 403, 429, 500])(
    "never reports success or exposes provider data on HTTP %s",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json({ message: "private provider detail" }, { status }),
      );
      await expect(
        sendAccountMail({
          to: "recipient@example.test",
          subject: "test",
          text: "test",
        }),
      ).rejects.toMatchObject({ code: "ACCOUNT_MAIL_FAILED", status: 503 });
    },
  );
  it("rejects missing acceptance ID, invalid JSON and network failure", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const result of [Response.json({}), new Response("not-json")]) {
      fetch.mockResolvedValueOnce(result);
      await expect(
        sendAccountMail({
          to: "recipient@example.test",
          subject: "test",
          text: "test",
        }),
      ).rejects.toMatchObject({ code: "ACCOUNT_MAIL_FAILED" });
    }
    fetch.mockRejectedValueOnce(new Error("secret diagnostic"));
    await expect(
      sendAccountMail({
        to: "recipient@example.test",
        subject: "test",
        text: "test",
      }),
    ).rejects.toMatchObject({ message: "账号邮件暂时无法发出，请稍后重试" });
  });
  it("fails closed when the selected provider key is missing, even if SMTP variables exist", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "smtp.example.test");
    expect(accountMailConfiguration()).toBeNull();
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(
      sendAccountMail({
        to: "recipient@example.test",
        subject: "test",
        text: "test",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MAIL_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects unsafe public origin and header injection in sender configuration", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_PUBLIC_BASE_URL", "http://project.luojiatutor.xyz");
    expect(accountMailConfiguration()).toBeNull();
    vi.stubEnv("AUTH_PUBLIC_BASE_URL", "https://project.luojiatutor.xyz");
    vi.stubEnv(
      "AUTH_EMAIL_FROM",
      "sender@example.test\r\nBcc: other@example.test",
    );
    expect(accountMailConfiguration()).toBeNull();
  });
});
