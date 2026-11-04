"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BookOpen, LogIn, LogOut, User, LoaderCircle, ShieldCheck } from "lucide-react";
import { bindConversationDraftOwner, clearConversationDrafts } from "@/lib/client/conversationDrafts";
import { bindCaptureDraftOwner, clearCaptureDrafts, captureGeneration } from "@/lib/client/captureDrafts";

interface UserState {
  id: string;
  username: string;
  displayName: string;
}

export function UserNav({ isMenuItem = false, liveLlm = false }: { isMenuItem?: boolean; liveLlm?: boolean }) {
  const [user, setUser] = useState<UserState | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let generation = 0;
    async function checkAuth() {
      const read = ++generation;
      const draftGeneration = captureGeneration();
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (active && read === generation && draftGeneration !== captureGeneration()) { void checkAuth(); return; }
        if (res.ok) {
          const data = await res.json();
          if (active && read === generation && draftGeneration !== captureGeneration()) { void checkAuth(); return; }
          if (active && read === generation && draftGeneration === captureGeneration()) {
            if (data.user?.id) { bindConversationDraftOwner(data.user.id); bindCaptureDraftOwner(data.user.id); }
            setUser(data.user ?? null);
          }
        } else {
          if (active && read === generation && draftGeneration === captureGeneration()) { if (res.status === 401) { clearConversationDrafts(); clearCaptureDrafts(); } setUser(null); }
        }
      } catch {
        if (active && read === generation && draftGeneration === captureGeneration()) setUser(null);
      } finally {
        if (active && read === generation) setLoading(false);
      }
    }
    checkAuth();
    window.addEventListener("projectmemo:session-changed", checkAuth);
    const storageAuth = (event: StorageEvent) => { if (event.key === null || event.key === "projectmemo:capture-owner") void checkAuth(); };
    window.addEventListener("storage", storageAuth);
    return () => {
      active = false;
      window.removeEventListener("projectmemo:session-changed", checkAuth);
      window.removeEventListener("storage", storageAuth);
    };
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    setError("");
    const logoutGeneration = captureGeneration();
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (logoutGeneration !== captureGeneration()) return;
      if (!response.ok) throw new Error("logout failed");
      clearConversationDrafts();
      clearCaptureDrafts();
      setUser(null);
      window.location.assign("/login");
    } catch {
      setError("退出未完成，当前登录仍保留，请重试。");
    } finally {
      setLoggingOut(false);
    }
  };

  if (loading) {
    return isMenuItem ? (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--ink-soft)]">
        <LoaderCircle size={14} className="animate-spin" /> 检查登录...
      </div>
    ) : (
      <div className="flex h-9 w-9 items-center justify-center text-[var(--muted)]">
        <LoaderCircle size={15} className="animate-spin" />
      </div>
    );
  }

  // 移动端菜单形态
  if (isMenuItem) {
    if (!user) {
      return (
        <Link
          href="/login"
          className="focus-ring flex w-full items-center gap-2 rounded-md bg-[var(--teal-pale)] px-3 py-2 text-sm font-bold text-[var(--teal-strong)] transition hover:bg-[var(--teal)] hover:text-white"
        >
          <LogIn size={16} /> 登录演示空间
        </Link>
      );
    }

    return (
      <div className="space-y-1 border-t border-[var(--rule)] pt-2">
        <div className="flex items-center gap-2 px-3 py-1 text-xs text-[var(--ink-soft)]">
          <User size={13} className="text-[var(--teal)]" />
          <span className="truncate font-medium">{user.displayName || user.username}</span>
        </div>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="focus-ring flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-[var(--brick)] transition hover:bg-[var(--brick-pale)]"
        >
          <LogOut size={16} /> {loggingOut ? "退出中..." : "退出登录"}
        </button>
        {error && <p role="alert" className="px-3 text-xs text-[var(--brick)]">{error}</p>}
      </div>
    );
  }

  // 桌面端形态
  if (!user) {
    return (
      <Link
        href="/login"
        className="focus-ring flex items-center gap-1.5 rounded-md bg-[var(--teal-pale)] px-3 py-1.5 text-xs font-bold text-[var(--teal-strong)] transition hover:bg-[var(--teal)] hover:text-white shadow-sm"
      >
        <LogIn size={14} /> 登录
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="账号与设置"
        aria-expanded={menuOpen}
        className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-[var(--teal-pale)] text-sm font-bold text-[var(--teal-strong)] transition hover:shadow-[inset_0_0_0_1px_var(--teal)]"
      >
        我
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] p-2 shadow-xl animate-scale-in">
            <div className="border-b border-[var(--rule)] px-3 py-2">
              <p className="text-xs font-bold text-[var(--ink)]">{user.displayName}</p>
              <p className="font-mono text-xs text-[var(--ink-soft)]">@{user.username}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-soft)]"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${liveLlm ? "bg-[var(--teal)]" : "bg-[var(--muted)]"}`} />{liveLlm ? "云模型已配置" : "演示模式"}</p>
            </div>
            <Link
              href="/settings/memory"
              prefetch={false}
              onClick={() => setMenuOpen(false)}
              className="focus-ring mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-[var(--ink-soft)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--teal-strong)]"
            >
              <BookOpen size={14} /> 我的记忆
            </Link>
            <Link
              href="/settings/model"
              prefetch={false}
              onClick={() => setMenuOpen(false)}
              className="focus-ring flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-[var(--ink-soft)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--teal)]"
            >
              <ShieldCheck size={14} /> 模型与安全
            </Link>
            <ThemeToggle isMenuItem />
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="focus-ring mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-[var(--brick)] transition hover:bg-[var(--brick-pale)]"
            >
              <LogOut size={14} /> {loggingOut ? "退出中..." : "退出登录"}
            </button>
            {error && <p role="alert" className="px-3 text-xs text-[var(--brick)]">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
