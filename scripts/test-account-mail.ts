import { z } from "zod";
import { sendAccountMail } from "../lib/auth/mail";

const index = process.argv.indexOf("--to");
const recipient = z.email().safeParse(index >= 0 ? process.argv[index + 1] : "");
if (!recipient.success) {
  console.error("用法：npm run auth:mail:test -- --to 你控制的收件邮箱");
  process.exitCode = 1;
} else {
  try {
    await sendAccountMail({ to: recipient.data, subject: "忆程 ProjectMemo 邮件服务接入测试", text: "这是一封由维护者主动发送的忆程邮件测试。看到这封邮件，表示本次测试已到达你的邮箱。本邮件不会创建账号、验证邮箱或更改密码。" });
    console.log("邮件服务已接受测试邮件，请在收件箱及服务商投递日志中确认到达。");
  } catch {
    console.error("测试邮件发送失败。请核对 Resend 或 SMTP 配置与已验证发信域名；本命令不会输出凭证。");
    process.exitCode = 1;
  }
}
