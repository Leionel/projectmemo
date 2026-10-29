import nodemailer from "nodemailer";
import { AppError } from "@/lib/api";
import { randomUUID } from "node:crypto";

export type AccountMail = {
  to: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
};

export function accountMailConfiguration() {
  const {
    SMTP_HOST: host,
    SMTP_USER: user,
    SMTP_PASSWORD: pass,
    AUTH_PUBLIC_BASE_URL: base,
  } = process.env;
  const from = process.env.AUTH_EMAIL_FROM || process.env.SMTP_FROM;
  if (!from || /[\r\n]/.test(from) || !base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    return null;
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    return null;
  const selected =
    process.env.AUTH_MAIL_TRANSPORT ||
    (process.env.RESEND_API_KEY ? "resend" : "smtp");
  if (selected === "resend") {
    if (!process.env.RESEND_API_KEY?.trim()) return null;
    return {
      transport: "resend" as const,
      apiKey: process.env.RESEND_API_KEY.trim(),
      from,
      baseUrl: url.origin,
    };
  }
  if (selected !== "smtp" || !host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || "465");
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    transport: "smtp" as const,
    host,
    user,
    pass,
    from,
    baseUrl: url.origin,
    port,
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === "true"
      : port === 465,
  };
}

export function requireAccountMail() {
  const config = accountMailConfiguration();
  if (!config)
    throw new AppError(
      "ACCOUNT_MAIL_UNAVAILABLE",
      "账号邮件服务尚未配置，注册和找回密码暂不可用；已有账号仍可登录",
      503,
    );
  return config;
}

/** Only tests mock this function. Production has no log/console delivery mode. */
export async function sendAccountMail(message: AccountMail): Promise<void> {
  const config = requireAccountMail();
  const idempotencyKey =
    message.idempotencyKey ?? "account-mail/" + randomUUID();
  if (config.transport === "resend") {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + config.apiKey,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          from: config.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });
      if (!response.ok) throw new Error("Mail request rejected");
      const result = (await response.json()) as { id?: unknown };
      if (typeof result.id !== "string" || !result.id)
        throw new Error("Mail request not accepted");
      return;
    } catch {
      throw new AppError(
        "ACCOUNT_MAIL_FAILED",
        "账号邮件暂时无法发出，请稍后重试",
        503,
      );
    }
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      headers: { "Resend-Idempotency-Key": idempotencyKey },
    });
    if (!result.accepted?.length || result.rejected?.length)
      throw new Error("Recipient not accepted");
  } catch {
    // SMTP errors can contain credentials, addresses or provider diagnostics.
    throw new AppError(
      "ACCOUNT_MAIL_FAILED",
      "验证邮件暂时无法发出，请稍后重试",
      503,
    );
  } finally {
    transport.close();
  }
}
