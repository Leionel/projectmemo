"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { prefersReducedMotion, useFocusTrap } from "./motionHooks";
import styles from "./ConversationPanel.module.css";

const EXIT_MS = 140;

/** Overlay shell: centered dialog on desktop (or right drawer with variant="drawer"), bottom sheet on narrow screens.
 *  Rendered through a portal so page-level sticky headers cannot intercept its clicks. */
export function OverlayPanel({ label, title, onClose, variant, children }: {
  label: string; title: string; onClose: () => void; variant?: "drawer"; children: React.ReactNode;
}) {
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const close = useCallback(() => {
    if (prefersReducedMotion()) { onClose(); return; }
    setClosing(true);
    timer.current = window.setTimeout(onClose, EXIT_MS);
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); window.clearTimeout(timer.current); };
  }, [close]);
  if (typeof document === "undefined") return null;
  return createPortal(<div className={styles.overlay + (variant === "drawer" ? " " + styles.overlayDrawer : "")} data-closing={closing ? "" : undefined}
    onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      className={styles.dialog + (variant === "drawer" ? " " + styles.dialogDrawer : "")}>
      <div className={styles.dialogHead}><strong>{title}</strong>
        <button type="button" className={styles.dialogClose + " focus-ring"} aria-label="关闭" onClick={close}><X size={16}/></button>
      </div>
      {children}
    </div>
  </div>, document.body);
}
