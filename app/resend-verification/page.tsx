import type { Metadata } from "next";
import { AuthScreen } from "@/components/AuthScreen";
export const metadata: Metadata = {
  title: "重发验证邮件｜忆程 ProjectMemo",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <AuthScreen mode="resend-verification" />;
}
