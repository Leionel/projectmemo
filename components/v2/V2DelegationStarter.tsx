"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Paperclip, ShieldCheck } from "lucide-react";
import { MaterialInput } from "./MaterialInput";
import { PROJECT_PRESETS, type PROJECT_PRESET_IDS } from "@/lib/intake/projectPresets";
import { V2_DELEGATION_LIMITS } from "@/lib/types/v2Delegation";
import styles from "./V2DelegationStarter.module.css";

type Preview = { previewHash: string; expiresAt: string };
type StartInput = { goal: string; materialText: string; materialName?: string; presetId?: typeof PROJECT_PRESET_IDS[number] };
type StartRequest = { input: StartInput; requestId: string; preview?: Preview };

class DelegationRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

async function post<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000), body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new DelegationRequestError(
    typeof value.error === "string" ? value.error : value.error?.message ?? "请求未完成，请重试",
    response.status, value.error?.code,
  );
  return value as T;
}

export function V2DelegationStarter({ projectId }: { projectId: string }) {
  const [materialText, setMaterial] = useState(""), [goal, setGoal] = useState("");
  const [materialName, setMaterialName] = useState<string>(), [presetId, setPresetId] = useState<StartInput["presetId"]>();
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false);
  const [error, setError] = useState(""), [reading, setReading] = useState(false);
  const pending = useRef<StartRequest | null>(null), inFlight = useRef(false);
  const materialDetails = useRef<HTMLDetailsElement>(null);
  const base = "/api/projects/" + encodeURIComponent(projectId) + "/v2-delegation";

  async function start(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || reading || goal.trim().length < 3) return;
    const request = pending.current ??= {
      requestId: crypto.randomUUID(),
      input: { goal: goal.trim(), materialText, ...(materialName && { materialName }), ...(presetId && { presetId }) },
    };
    inFlight.current = true;
    setBusy(true);
    setLocked(true);
    setError("");
    try {
      request.preview ??= await post<Preview>(base + "/preview", request.input);
      const result = await post<{ workbenchUrl: string }>(base + "/confirm", { ...request.input, requestId: request.requestId,
        previewHash: request.preview.previewHash, expiresAt: request.preview.expiresAt });
      window.location.assign(result.workbenchUrl);
    } catch (cause) {
      if (cause instanceof DelegationRequestError && cause.status < 500 && cause.status !== 408) {
        pending.current = null;
        setLocked(false);
        setError(cause.message);
        if (cause.code === "DELEGATION_MATERIAL_REQUIRED" && materialDetails.current) materialDetails.current.open = true;
      } else {
        setError("开始结果尚未确认。可以重试同一个托付请求。");
      }
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  }

  return <section className={styles.panel} aria-label="创建持续跟进委托">
    <header className={styles.heading}><h3>交给忆程持续跟进</h3></header>
    <form onSubmit={start} className={styles.form}>
      <label>这次要完成什么<input value={goal} onChange={event => setGoal(event.target.value)} minLength={3} maxLength={300} required
        disabled={locked} placeholder="例如：根据测试记录持续更新发布说明" /></label>
      <details ref={materialDetails} className={styles.options}>
        <summary><Paperclip size={15} aria-hidden />{materialName || (materialText.trim() ? "已补充资料" : "补资料或选场景")}</summary>
        <label>起步场景<select value={presetId ?? ""} disabled={locked} onChange={event => {
          const selected = PROJECT_PRESETS.find(preset => preset.id === event.target.value);
          const old = PROJECT_PRESETS.find(preset => preset.id === presetId);
          setPresetId(selected?.id);
          if (selected && (!goal || goal === old?.goal)) setGoal(selected.goal);
        }}><option value="">自定义目标</option>{PROJECT_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
        <MaterialInput projectId={projectId} value={materialText} name={materialName} required={false} disabled={locked}
          onReadingChange={setReading} onChange={(text, name) => { setMaterial(text); setMaterialName(name); }} />
      </details>
      <div className={styles.scope} id="v2-delegation-scope">
        <ShieldCheck size={18} aria-hidden />
        <p>使用当前项目中获准的资料，由模型在后台生成私有稿。{materialText.trim() && "补充资料会一并保存。"}跟进 {V2_DELEGATION_LIMITS.days} 天，最多 {V2_DELEGATION_LIMITS.maxModels} 次模型调用，可随时暂停。{presetId === "client" && "本项目将关闭个人上下文。"}</p>
      </div>
      <details className={styles.limits}><summary>查看跟进权限和调用上限</summary>
        <p>最多 {V2_DELEGATION_LIMITS.maxModels} 次模型、{V2_DELEGATION_LIMITS.maxTools} 次工具。外部搜索、业务写入和外发需另行授权。</p>
      </details>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className="editorial-button" aria-describedby="v2-delegation-scope" disabled={busy || reading || goal.trim().length < 3}>
          {busy ? "正在开始跟进…" : locked ? "重试原托付" : "交给忆程跟进"}<ArrowUpRight size={15} aria-hidden />
        </button>
      </div>
    </form>
  </section>;
}
