"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const SKIP = "[data-no-popup]";
const VISIBLE_MS = 6000;
const REPEAT_AFTER_MS = 30000;

type Popup = { id: number; text: string };

function isOnScreen(element: Element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
}

/**
 * 页面内的错误提示可能在屏幕外，这里统一弹出，不用逐个组件改。
 * 原位提示保留（重试按钮都在那里）；已经在屏幕内的不重复弹。
 */
export function ErrorPopupHost() {
  const [popups, setPopups] = useState<Popup[]>([]);
  const lastShown = useRef(new Map<string, number>());
  const nextId = useRef(0);

  useEffect(() => {
    function scan() {
      const now = Date.now();
      for (const element of document.querySelectorAll('[role="alert"]')) {
        if (element.closest(SKIP) || isOnScreen(element)) continue;
        const text = element.textContent?.trim();
        if (!text || now - (lastShown.current.get(text) ?? 0) < REPEAT_AFTER_MS) continue;
        lastShown.current.set(text, now);
        const id = nextId.current++;
        setPopups(current => [...current.slice(-2), { id, text }]);
        window.setTimeout(() => setPopups(current => current.filter(popup => popup.id !== id)), VISIBLE_MS);
      }
    }
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  if (popups.length === 0) return null;
  return (
    <div data-no-popup className="pointer-events-none fixed inset-x-4 top-4 z-[100] mx-auto flex max-w-md flex-col gap-2">
      {popups.map(popup => (
        <div key={popup.id} role="status" className="pointer-events-auto flex items-start gap-2 rounded-lg border border-[var(--rule)] bg-[var(--brick-pale)] px-4 py-3 text-sm font-medium text-[var(--brick)] shadow-lg">
          <p className="min-w-0 flex-1 break-words">{popup.text}</p>
          <button type="button" aria-label="关闭提示" className="focus-ring shrink-0" onClick={() => setPopups(current => current.filter(item => item.id !== popup.id))}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
