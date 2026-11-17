"use client";
import { useState, type FormEvent } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import styles from "./V2DelegationStarter.module.css";
import { MaterialInput } from "./MaterialInput";
import { PROJECT_PRESETS, type PROJECT_PRESET_IDS } from "@/lib/intake/projectPresets";

type DelegationPreview = {
  previewHash: string; goal: string; expiresAt: string;
  material: { length: number; preview: string; format: string; name: string | null; rows?: number; columns?: number };
  personalMemoryMode?: string;
  policy: { maxModels: number; maxTools: number };
  capabilities: { note: string };
};

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : value.error?.message ?? "请求未完成，请重试");
  return value;
}

export function V2DelegationStarter({ projectId }: { projectId: string }) {
  const [material, setMaterial] = useState(""), [goal, setGoal] = useState("");
  const [preview, setPreview] = useState<DelegationPreview | null>(null);
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [materialName, setMaterialName] = useState<string | undefined>(), [presetId, setPresetId] = useState<typeof PROJECT_PRESET_IDS[number] | "">("");
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [reading, setReading] = useState(false);

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (!material.trim() || !goal.trim() || busy || reading) return;
    setBusy(true); setError("");
    try {
      const value = await post(`/api/projects/${encodeURIComponent(projectId)}/v2-delegation/preview`, { goal: goal.trim(), materialText: material, expiresInDays: 7,
        ...(materialName ? { materialName } : {}), ...(presetId ? { presetId } : {}) });
      setPreview(value); setRequestId(crypto.randomUUID());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "预览未完成"); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!preview || busy) return;
    setBusy(true); setError("");
    setConfirmationPending(true);
    try {
      const value = await post(`/api/projects/${encodeURIComponent(projectId)}/v2-delegation/confirm`,
        { requestId, goal: goal.trim(), materialText: material, previewHash: preview.previewHash, expiresAt: preview.expiresAt,
          ...(materialName ? { materialName } : {}), ...(presetId ? { presetId } : {}) });
      window.location.assign(value.workbenchUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "确认未完成，原请求编号已保留，可重试"); setBusy(false); }
  }

  if (preview) return <section className={styles.panel} aria-label="确认持续跟进范围">
    <header className={styles.heading}><ShieldCheck size={18} aria-hidden="true" /><h3>确认这次持续跟进的范围</h3></header>
    <dl className={styles.facts}>
      <dt>目标</dt><dd>{preview.goal}</dd>
      <dt>资料</dt><dd>本项目资料，加上本次导入的 {preview.material.length} 字文本</dd>
      {preview.material.name && <><dt>文件</dt><dd>{preview.material.name}{preview.material.format === "CSV" ? ` · ${preview.material.rows} 行数据，${preview.material.columns} 列` : ""}</dd></>}
      {preview.personalMemoryMode === "PROJECT_ONLY" && <><dt>记忆范围</dt><dd>仅本项目资料；关闭此项目的个人上下文</dd></>}
      <dt>可持续到</dt><dd>{new Date(preview.expiresAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</dd>
      <dt>调用上限</dt><dd>最多 {preview.policy.maxModels} 次模型、{preview.policy.maxTools} 次工具</dd>
      <dt>不包含</dt><dd>联网检索、公开研究、业务写入、自动外发</dd>
    </dl>
    <details><summary>材料预览{preview.material.length > 400 ? "（前 400 字）" : ""}</summary><pre className={styles.materialPreview}>{preview.material.preview}</pre></details>
    <p className={styles.note}>{preview.capabilities.note}</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      <button type="button" className="editorial-button" disabled={busy} onClick={() => void confirm()}>{busy ? "正在创建…" : "确认并开始"}<ArrowUpRight size={15} aria-hidden="true" /></button>
      <button type="button" className="editorial-button-secondary" disabled={busy || confirmationPending} onClick={() => { setPreview(null); setError(""); }}>返回修改</button>
    </div>
  </section>;

  return <section className={styles.panel} aria-label="创建持续跟进委托">
    <header className={styles.heading}><h3>交给忆程持续跟进</h3></header>
    <form onSubmit={prepare} className={styles.form}>
      <label>起步场景<select value={presetId} onChange={event => {
        const next = event.target.value as typeof presetId;
        const old = PROJECT_PRESETS.find(preset => preset.id === presetId), selected = PROJECT_PRESETS.find(preset => preset.id === next);
        setPresetId(next); if (selected && (!goal || goal === old?.goal)) setGoal(selected.goal);
      }}><option value="">自定义目标</option>{PROJECT_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
      <label>这次要完成什么<input value={goal} onChange={event => setGoal(event.target.value)} maxLength={300} required placeholder="例如：整理下一版本发布说明" /></label>
      <MaterialInput projectId={projectId} value={material} name={materialName} disabled={busy} onReadingChange={setReading} onChange={(text, name) => { setMaterial(text); setMaterialName(name); }} />
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}><button type="submit" className="editorial-button" disabled={busy || reading || !material.trim() || !goal.trim()}>{busy ? "正在准备…" : "预览持续范围"}</button></div>
    </form>
  </section>;
}
