"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Check,
  CircleAlert,
  FolderOpen,
} from "lucide-react";
import { workspaceReturnPath } from "@/lib/auth/returnPath";
import styles from "@/app/auth.module.css";

export type AuthMode =
  | "login"
  | "register"
  | "forgot-password"
  | "reset-password"
  | "verify-email"
  | "resend-verification";
const content: Record<
  AuthMode,
  { title: string; description: string; action: string }
> = {
  login: {
    title: "登录忆程",
    description: "继续查看你的项目、记录和行动。",
    action: "登录工作台",
  },
  register: {
    title: "创建你的账号",
    description: "使用邮箱验证，开启自己的项目空间。",
    action: "注册并发送验证邮件",
  },
  "forgot-password": {
    title: "找回密码",
    description: "输入注册邮箱，我们会向它发送重置链接。",
    action: "发送重置邮件",
  },
  "reset-password": {
    title: "设置新密码",
    description: "更新后，原有设备上的登录状态会退出。",
    action: "保存新密码",
  },
  "verify-email": {
    title: "验证邮箱",
    description: "确认后即可使用这个邮箱对应的忆程账号。",
    action: "验证我的邮箱",
  },
  "resend-verification": {
    title: "重新发送验证邮件",
    description: "输入注册时使用的邮箱地址。",
    action: "发送验证邮件",
  },
};

function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const params = useSearchParams();
  const from = workspaceReturnPath(params.get("from"));
  const [token] = useState(() => params.get("token") ?? "");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [mailReady, setMailReady] = useState<boolean | null>(null);
  const [mailFailure, setMailFailure] = useState("");
  const text = content[mode];
  const usesMail = [
    "register",
    "forgot-password",
    "resend-verification",
  ].includes(mode);
  const hasPassword = ["login", "register", "reset-password"].includes(mode);
  const authQuery = "?from=" + encodeURIComponent(from);
  useEffect(() => {
    if (!usesMail && mode !== "login") return;
    const abort = new AbortController();
    fetch("/api/auth/capabilities", { signal: abort.signal, cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setMailReady(data.registrationEnabled === true);
        setMailFailure(
          data.registrationEnabled === true
            ? ""
            : "账号邮件服务尚未配置，注册和找回密码暂不可用。已有账号仍可正常登录。",
        );
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setMailReady(false);
          setMailFailure("暂时无法确认账号服务状态，请刷新页面或稍后再试。");
        }
      });
    return () => abort.abort();
  }, [usesMail, mode]);
  useEffect(() => {
    if (token) window.history.replaceState(null, "", window.location.pathname);
  }, [token]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setError("");
    if (
      (mode === "register" || mode === "reset-password") &&
      password !== confirmPassword
    ) {
      setError("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    const data =
      mode === "login"
        ? { username: username.trim(), password, client: "web" }
        : mode === "register"
          ? {
              username: username.trim(),
              email: email.trim(),
              password,
              confirmPassword,
            }
          : mode === "reset-password"
            ? { token, password, confirmPassword }
            : mode === "verify-email"
              ? { token }
              : { email: email.trim() };
    try {
      const response = await fetch("/api/auth/" + mode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = result?.error?.details?.[0]?.message;
        throw new Error(
          detail ||
            result?.error?.message ||
            (response.status === 401
              ? "账号或密码错误，请核对后重试"
              : "暂时无法提交，请稍后重试"),
        );
      }
      if (mode === "login") {
        window.dispatchEvent(new Event("projectmemo:session-changed"));
        router.push(from);
        router.refresh();
      } else setSuccess(result.message ?? "操作已完成");
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message !== "Failed to fetch"
          ? reason.message
          : "网络连接未成功，请稍后重试",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className={styles.layout}>
      <section className={styles.introduction} aria-label="忆程项目空间">
        <p className={styles.eyebrow}>你的个人项目空间</p>
        <h2>
          把项目，
          <br />
          接着做下去。
        </h2>
        <p>
          留下每次讨论、实验和调整。下次回来，能找到上次的进展，也能看清下一步。
        </p>
        <div className={styles.projectNote}>
          <FolderOpen size={21} aria-hidden="true" />
          <div>
            <strong>记录放回项目里</strong>
            <span>查看来源，核对判断，再确认行动。</span>
          </div>
        </div>
      </section>
      <section className={styles.panel} aria-labelledby="auth-title">
        <header>
          <h1 id="auth-title">{text.title}</h1>
          <p>{text.description}</p>
        </header>
        {success ? (
          <div className={styles.success} role="status">
            <Check size={23} aria-hidden="true" />
            <h2>{mode === "register" ? "请查收验证邮件" : "操作已完成"}</h2>
            <p>{success}</p>
            <Link className={styles.submit} href={"/login" + authQuery}>
              返回登录
              <ArrowRight size={16} />
            </Link>
            {mode === "register" && (
              <Link href="/resend-verification">没有收到？重新发送</Link>
            )}
          </div>
        ) : (
          <>
            {usesMail && mailReady === false && (
              <div className={styles.serviceNotice} role="status">
                {mailFailure}
                <Link href={"/login" + authQuery}>
                  返回登录
                  <ArrowRight size={13} />
                </Link>
              </div>
            )}
            {error && (
              <div id="auth-error" className={styles.error} role="alert">
                <CircleAlert size={17} aria-hidden="true" />
                <p>{error}</p>
              </div>
            )}
            <form
              method="post"
              action={"/api/auth/" + mode}
              onSubmit={submit}
              aria-busy={loading}
            >
              {(mode === "login" || mode === "register") && (
                <div className={styles.field}>
                  <label htmlFor="username">账号</label>
                  <input
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={username}
                    onChange={(event) =>
                      setUsername(
                        mode === "register"
                          ? event.target.value.toLowerCase()
                          : event.target.value,
                      )
                    }
                    required
                    disabled={loading}
                    placeholder="输入你的账号"
                    maxLength={mode === "register" ? 32 : undefined}
                    minLength={mode === "register" ? 3 : undefined}
                    aria-describedby={
                      mode === "register"
                        ? "username-help"
                        : error
                          ? "auth-error"
                          : undefined
                    }
                  />
                  {mode === "register" && (
                    <p id="username-help">
                      3–32 位字母、数字、下划线或短横线，以字母或数字开头。
                    </p>
                  )}
                </div>
              )}
              {usesMail && (
                <div className={styles.field}>
                  <label htmlFor="email">邮箱</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    maxLength={254}
                    required
                    disabled={loading}
                    placeholder="you@example.com"
                  />
                </div>
              )}
              {hasPassword && (
                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <label htmlFor="password">
                      {mode === "reset-password" ? "新密码" : "密码"}
                    </label>
                    <button
                      className={styles.passwordToggle}
                      type="button"
                      onClick={() => setVisible(!visible)}
                      aria-label={visible ? "隐藏密码" : "显示密码"}
                      aria-pressed={visible}
                    >
                      {visible ? <EyeOff size={15} /> : <Eye size={15} />}
                      <span>{visible ? "隐藏" : "显示"}</span>
                    </button>
                  </div>
                  <input
                    id="password"
                    name="password"
                    type={visible ? "text" : "password"}
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    disabled={loading}
                    minLength={mode === "login" ? undefined : 10}
                    maxLength={mode === "login" ? undefined : 128}
                    placeholder={
                      mode === "login" ? "输入你的密码" : "至少 10 个字符"
                    }
                    aria-describedby={error ? "auth-error" : undefined}
                  />
                </div>
              )}
              {(mode === "register" || mode === "reset-password") && (
                <div className={styles.field}>
                  <label htmlFor="confirm-password">确认密码</label>
                  <input
                    id="confirm-password"
                    name="confirmPassword"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    minLength={10}
                    maxLength={128}
                    disabled={loading}
                    placeholder="再次输入密码"
                  />
                </div>
              )}
              {mode === "verify-email" && !token && (
                <p className={styles.help}>
                  请打开验证邮件中的链接。没有收到邮件，可以
                  <Link href="/resend-verification">重新发送</Link>。
                </p>
              )}
              {mode === "reset-password" && !token && (
                <p className={styles.help}>
                  请打开重置邮件中的链接，或
                  <Link href="/forgot-password">重新申请邮件</Link>。
                </p>
              )}
              <button
                className={styles.submit}
                type="submit"
                disabled={
                  loading ||
                  (usesMail && mailReady !== true) ||
                  ((mode === "verify-email" || mode === "reset-password") &&
                    !token)
                }
              >
                {loading ? (
                  <>
                    <LoaderCircle
                      size={17}
                      className={styles.spinner}
                      aria-hidden="true"
                    />
                    正在提交…
                  </>
                ) : (
                  <>
                    {text.action}
                    <ArrowRight size={16} aria-hidden="true" />
                  </>
                )}
              </button>
              {mode === "register" && (
                <p className={styles.help}>
                  验证邮箱后才能登录。新账号不自带云模型调用额度。
                </p>
              )}
            </form>
            <div className={styles.links}>
              {mode === "login" ? (
                <>
                  {mailReady === true ? (
                    <Link href={"/register" + authQuery}>创建账号</Link>
                  ) : (
                    <span className={styles.help}>暂未开放注册</span>
                  )}
                  <Link href="/forgot-password">忘记密码？</Link>
                </>
              ) : (
                <Link href={"/login" + authQuery}>已有账号？返回登录</Link>
              )}
            </div>
            {(mode === "login" || error) && (
              <Link className={styles.resendLink} href="/resend-verification">
                重新发送邮箱验证
              </Link>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export function AuthScreen({ mode }: { mode: AuthMode }) {
  return (
    <main id="main-content" className={styles.auth}>
      <Suspense
        fallback={
          <p className={styles.loading} role="status">
            正在加载账号页面…
          </p>
        }
      >
        <AuthForm mode={mode} />
      </Suspense>
    </main>
  );
}
