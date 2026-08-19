"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ isMenuItem = false }: { isMenuItem?: boolean }) {
  const { setTheme } = useTheme();
  const className = isMenuItem
    ? "focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[var(--ink-soft)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--teal)]"
    : "focus-ring flex h-9 w-9 items-center justify-center rounded-xl text-[var(--ink-soft)] transition-colors hover:bg-[var(--card-bg)] dark:hover:bg-black/20";

  function toggleTheme() {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <button onClick={toggleTheme} className={className} aria-label="切换深浅色主题">
      <span className="dark:hidden" aria-hidden="true"><Moon size={18} /></span>
      <span className="hidden dark:inline" aria-hidden="true"><Sun size={18} /></span>
      {isMenuItem && (
        <>
          <span className="dark:hidden">暗色模式</span>
          <span className="hidden dark:inline">浅色模式</span>
        </>
      )}
    </button>
  );
}
