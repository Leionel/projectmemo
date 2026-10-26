"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationView } from "@/lib/types/conversation";
import type { AnchorView } from "@/lib/types/conversationAnchor";
import styles from "./ConversationAnchorPanel.module.css";

type AnchorReply = { anchors: AnchorView[]; enabled?: boolean; conversation?: ConversationView };
type AnchorAction = "FOLLOW" | "LATER" | "STOP" | "ACK";
type Props = {
  conversationId: string; revision: number; busy: boolean;
  acquire: () => boolean; release: () => void;
  onUpdated: (view: ConversationView) => void;
  onReadResults?: () => void;
};

async function request(url: string, body?: object): Promise<AnchorReply> {
  const response = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message ?? "后续结果暂不可读"), { status: response.status });
  return result as AnchorReply;
}

export function ConversationAnchorPanel(props: Props) {
  const [anchors, setAnchors] = useState<AnchorView[]>([]), [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(props), live = useRef(false), running = useRef(false), coldSync = useRef(false);
  const visible = useRef(false), region = useRef<HTMLElement>(null);
  const keys = useRef(new Map<string, string>());
  const readGeneration = useRef(0);
  useEffect(() => { current.current = props; });
  const apply = useCallback((reply: AnchorReply) => {
    if (!live.current) return;
    setAnchors(reply.anchors);
    if (reply.enabled !== undefined) setEnabled(reply.enabled);
    if (reply.conversation) current.current.onUpdated(reply.conversation);
  }, []);
  const read = useCallback(async () => {
    if (running.current) return;
    const epoch = ++readGeneration.current;
    try { const result = await request("/api/conversations/" + current.current.conversationId + "/anchors"); if (epoch === readGeneration.current) apply(result); }
    catch (e) { if (live.current && epoch === readGeneration.current) setError(e instanceof Error ? e.message : "后续结果暂不可读"); }
  }, [apply]);
  const sync = useCallback(async (explicit = false) => {
    if (running.current || !current.current.acquire()) return false;
    running.current = true; readGeneration.current++;
    try {
      const result = await request("/api/conversations/" + current.current.conversationId + "/anchors/sync", {});
      apply(result); if (live.current) {
        setError("");
        if (explicit) requestAnimationFrame(() => { if (live.current) current.current.onReadResults?.(); });
      } return true;
    } catch (e) { if (live.current) setError(e instanceof Error ? e.message : "读取失败，请重试"); return false; }
    finally { running.current = false; current.current.release(); }
  }, [apply]);
  useEffect(() => {
    live.current = true;
    const observer = new IntersectionObserver(([entry]) => { visible.current = entry.isIntersecting; });
    if (region.current) observer.observe(region.current);
    return () => { live.current = false; observer.disconnect(); };
  }, []);
  useEffect(() => { void read(); }, [props.revision, read]);
  const hasAnchors = anchors.length > 0;
  const hasSubscription = anchors.some(anchor => anchor.mode === "FOLLOWING" || anchor.mode === "LATER");
  useEffect(() => {
    if (!enabled || !hasAnchors) return;
    const recover = () => {
      if (!current.current.busy && !coldSync.current && document.visibilityState === "visible") {
        coldSync.current = true; void sync();
      }
    };
    recover();
    document.addEventListener("visibilitychange", recover);
    return () => document.removeEventListener("visibilitychange", recover);
  }, [enabled, hasAnchors, props.busy, sync]);
  useEffect(() => {
    if (!enabled || !hasSubscription) return;
    const refresh = () => {
      if (!visible.current || document.visibilityState !== "visible" || current.current.busy) return;
      void sync();
    };
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [enabled, hasSubscription, sync]);
  async function act(anchor: AnchorView, action: AnchorAction) {
    if (running.current || !current.current.acquire()) return;
    running.current = true; readGeneration.current++;
    const fingerprint = anchor.id + ":" + anchor.version + ":" + action + ":" + anchor.projectedSeq;
    let requestId = keys.current.get(fingerprint);
    if (!requestId) { requestId = crypto.randomUUID(); keys.current.set(fingerprint, requestId); }
    try {
      apply(await request("/api/conversations/" + props.conversationId + "/anchors/" + anchor.id,
        { requestId, expectedVersion: anchor.version, action, ...(action === "ACK" ? { seenSeq: anchor.projectedSeq } : {}) }));
      if (live.current) setError("");
    } catch (e) { if (live.current) { setError(e instanceof Error ? e.message : "操作失败，请重试");
      try { apply(await request("/api/conversations/" + props.conversationId + "/anchors")); } catch { /* Keep the actionable error. */ }
    } }
    finally { running.current = false; current.current.release(); }
  }
  return <section ref={region} className={styles.panel} aria-label="讨论后续">
    {anchors.length > 0 && <><div className={styles.header}><h3>讨论后续</h3><button type="button" className="workspace-link focus-ring" disabled={props.busy} onClick={() => void sync(true)}>读取新结果</button></div>
      <ul>{anchors.map(anchor => <li key={anchor.id}>
        <div className={styles.title}><strong>{anchor.title}</strong><span>{anchor.unread > 0 ? anchor.unread + " 条未读" : anchor.mode === "FOLLOWING" ? "关注中" : anchor.mode === "LATER" ? "稍后再看" : anchor.mode === "STOPPED" ? "已停止关注" : ""}</span></div>
        <div className={styles.actions}>
          {enabled && anchor.mode !== "FOLLOWING" && <button type="button" disabled={props.busy} className="workspace-link focus-ring" onClick={() => void act(anchor, "FOLLOW")}>关注后续</button>}
          {enabled && anchor.mode === "FOLLOWING" && <button type="button" disabled={props.busy} className="workspace-link focus-ring" onClick={() => void act(anchor, "LATER")}>稍后再看</button>}
          {["FOLLOWING", "LATER"].includes(anchor.mode) && <button type="button" disabled={props.busy} className="workspace-link focus-ring" onClick={() => void act(anchor, "STOP")}>停止关注</button>}
          {anchor.unread > 0 && <button type="button" disabled={props.busy} className="workspace-link focus-ring" onClick={() => void act(anchor, "ACK")}>标记已读</button>}
        </div>
      </li>)}</ul></>}
    {error && <p role="alert" className={styles.error}>{error} <button type="button" disabled={props.busy} className="workspace-link focus-ring" onClick={() => void read()}>重试</button></p>}
  </section>;
}
