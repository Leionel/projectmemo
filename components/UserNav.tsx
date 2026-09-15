"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogIn, LogOut, User, LoaderCircle } from "lucide-react";

interface UserState {
  id: string;
  username: string;
  displayName: string;
}

export function UserNav({ isMenuItem = false }: { isMenuItem?: boolean }) {
  const [user, setUser] = useState<UserState | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          if (active && data.user) {
            setUser(data.user);
          }
        } else {
          if (active) setUser(null);
        }
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    checkAuth();
    return () => {
      active = false;
    };
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      window.location.assign("/login");
    } catch {
      window.location.assign("/login");
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
          className="focus-ring flex w-full items-center gap-2 rounded-xl bg-[var(--teal-pale)] px-3 py-2 text-sm font-bold text-[var(--teal-strong)] transition hover:bg-[var(--teal)] hover:text-white"
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
          className="focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[var(--brick)] transition hover:bg-[var(--brick-pale)]"
        >
          <LogOut size={16} /> {loggingOut ? "退出中..." : "退出登录"}
        </button>
      </div>
    );
  }

  // 桌面端形态
  if (!user) {
    return (
      <Link
        href="/login"
        className="focus-ring flex items-center gap-1.5 rounded-xl bg-[var(--teal-pale)] px-3 py-1.5 text-xs font-bold text-[var(--teal-strong)] transition hover:bg-[var(--teal)] hover:text-white shadow-sm"
      >
        <LogIn size={14} /> 登录
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="focus-ring flex items-center gap-1.5 rounded-xl border border-[var(--rule)] bg-[var(--paper-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:border-[var(--teal)]"
      >
        <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--teal-pale)] text-[10px] text-[var(--teal-strong)]">
          <User size={12} />
        </span>
        <span className="max-w-[100px] truncate">{user.displayName || user.username}</span>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-2xl border border-[var(--rule)] bg-[var(--card-bg)] p-2 shadow-xl animate-scale-in">
            <div className="border-b border-[var(--rule)] px-3 py-2">
              <p className="text-xs font-bold text-[var(--ink)]">{user.displayName}</p>
              <p className="font-mono text-[11px] text-[var(--ink-soft)]">@{user.username}</p>
            </div>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="focus-ring mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-[var(--brick)] transition hover:bg-[var(--brick-pale)]"
            >
              <LogOut size={14} /> {loggingOut ? "退出中..." : "退出登录"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
