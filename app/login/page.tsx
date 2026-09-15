"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LoaderCircle, ShieldAlert, Sparkles } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/projects";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const DEMO_USER = "contest-demo";
  const DEMO_PASS = "contest-demo-2026";

  const fillDemoAccount = () => {
    setUsername(DEMO_USER);
    setPassword(DEMO_PASS);
    setError("");
  };

  const handleLogin = async (e?: React.FormEvent, customUser?: string, customPass?: string) => {
    if (e) e.preventDefault();

    const u = (customUser ?? username).trim();
    const p = customPass ?? password;

    if (!u || !p) {
      setError("请输入账号与密码");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p, client: "web" }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("账号或密码错误，请核对后重试");
        } else if (res.status === 429) {
          throw new Error("尝试次数过多，请稍后再试");
        } else {
          throw new Error(data?.error?.message || "登录失败，请检查网络设置");
        }
      }

      // 登录成功，跳转至目标页面
      router.push(from);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录遇到异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = async () => {
    fillDemoAccount();
    await handleLogin(undefined, DEMO_USER, DEMO_PASS);
  };

  return (
    <div className="mx-auto w-full max-w-md animate-fade-in">
      {/* 顶部品牌区 */}
      <div className="mb-8 text-center">
        <Link href="/" className="inline-flex items-center gap-3 transition hover:opacity-80">
          <Image
            src="/logo.png"
            alt="忆程 Logo"
            width={48}
            height={48}
            className="h-12 w-12 rounded-xl object-cover shadow-[var(--shadow-sm)]"
          />
          <div className="text-left">
            <span className="majestic-heading block text-xl">忆程 ProjectMemo</span>
            <span className="text-xs font-semibold tracking-wider text-[var(--ink-soft)]">
              复赛评审与演示登录
            </span>
          </div>
        </Link>
      </div>

      {/* 演示账号快捷提示条 */}
      <div className="mb-6 rounded-2xl border border-[var(--rule)] border-l-4 border-l-[var(--teal)] bg-[var(--card-bg)] p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--teal-strong)]">
              <Sparkles size={15} /> 预置复赛演示账号
            </p>
            <div className="mt-1.5 space-y-0.5 text-xs text-[var(--ink-soft)]">
              <p>
                账号：<code className="rounded bg-[var(--paper-strong)] px-1.5 py-0.5 font-mono text-[var(--ink)]">contest-demo</code>
              </p>
              <p>
                密码：<code className="rounded bg-[var(--paper-strong)] px-1.5 py-0.5 font-mono text-[var(--ink)]">contest-demo-2026</code>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleQuickDemoLogin}
            disabled={loading}
            className="focus-ring shrink-0 rounded-xl bg-[var(--teal-pale)] px-3 py-1.5 text-xs font-bold text-[var(--teal-strong)] transition hover:bg-[var(--teal)] hover:text-white"
          >
            一键登录
          </button>
        </div>
      </div>

      {/* 登录卡片 */}
      <div className="card-surface relative rounded-[1.7rem] p-6 sm:p-8 shadow-sm">
        <div className="dark-glow rounded-[1.7rem]" />
        
        <div className="mb-6 border-b archive-rule pb-4">
          <p className="archive-label">身份凭证核验</p>
          <h1 className="mt-1.5 text-xl font-bold font-sans text-[var(--ink)]">登录演示空间</h1>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            服务端强校验项目访问归属，未授权请求将被安全拦截。
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 flex items-center gap-2.5 rounded-xl border border-[var(--brick-pale)] bg-[var(--brick-pale)] p-3 text-sm font-medium text-[var(--brick)]"
          >
            <ShieldAlert size={18} className="shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label htmlFor="username" className="block text-sm font-bold text-[var(--ink)]">
              账号 / 用户名
            </label>
            <div className="relative mt-1.5">
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={loading}
                placeholder="请输入演示账号，如 contest-demo"
                className="focus-ring editorial-input w-full px-4 py-3 placeholder:text-[var(--placeholder)]"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-bold text-[var(--ink)]">
                密码
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="flex items-center gap-1 text-xs font-medium text-[var(--ink-soft)] hover:text-[var(--teal)]"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                {showPassword ? "隐藏" : "显示"}
              </button>
            </div>
            <div className="relative mt-1.5">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                placeholder="请输入密码，如 contest-demo-2026"
                className="focus-ring editorial-input w-full px-4 py-3 placeholder:text-[var(--placeholder)]"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="focus-ring editorial-button w-full justify-center py-3 text-base disabled:opacity-50"
            >
              {loading ? (
                <>
                  <LoaderCircle className="animate-spin" size={18} />
                  正在连接验证...
                </>
              ) : (
                <>
                  进入演示空间 <ArrowRight size={18} />
                </>
              )}
            </button>
          </div>
        </form>

        <div className="mt-5 border-t archive-rule pt-4 text-center">
          <button
            type="button"
            onClick={fillDemoAccount}
            className="text-xs text-[var(--ink-soft)] hover:text-[var(--teal)] hover:underline"
          >
            填入默认账号密码
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main id="main-content" className="shell flex min-h-[calc(100vh-140px)] items-center justify-center py-12">
      <Suspense fallback={<div className="text-center text-sm text-[var(--ink-soft)]">正在加载...</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
