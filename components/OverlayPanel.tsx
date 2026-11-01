"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import styles from "./ConversationPanel.module.css";

/** Overlay shell: centered dialog on desktop (or right drawer with variant="drawer"), bottom sheet on narrow screens.
 *  Rendered through a portal so page-level sticky headers cannot intercept its clicks. */
export function OverlayPanel({ label, title, onClose, variant, children }: {
  label: string; title: string; onClose: () => void; variant?: "drawer"; children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(<div className={styles.overlay + (variant === "drawer" ? " " + styles.overlayDrawer : "")}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={panelRef} role="dialog" aria-label={label} tabIndex={-1}
      className={styles.dialog + (variant === "drawer" ? " " + styles.dialogDrawer : "")}>
      <div className={styles.dialogHead}><strong>{title}</strong>
        <button type="button" className={styles.dialogClose + " focus-ring"} aria-label="关闭" onClick={onClose}><X size={16}/></button>
      </div>
      {children}
    </div>
  </div>, document.body);
}
