"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { bindCaptureDraftOwner, captureGeneration, captureOwner, onCaptureOwnerChange } from "@/lib/client/captureDrafts";
import { ArrowRight, FileText, LoaderCircle, Paperclip, ShieldCheck } from "lucide-react";
import { scenarioOptions } from "@/lib/types";
import { IntakeCoveragePanel } from "./IntakeCoveragePanel";
import type { IntakePreview } from "@/lib/intake/contracts";

/**
 * 项目前材料理解面板。
 *
 * 三类信息在版面上是分开的：材料原文（带出处）、Agent 推断（标明建议）、未知。
 * 用户改写的是「自己要接受的目标」，不是模型建议本身；按钮禁用不构成服务端校验，
 * 确认时仍由后端重算材料 hash、预览 hash 与修订。
 */

type DraftSummary = { id: string; status: string; revision: number; understandingState: string; expiresAt: string };

const fieldClass = "focus-ring editorial-input mt-2 w-full px-4 py-3 placeholder:text-[var(--placeholder)]";

async function sendJson(url: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, { method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message ?? "请求失败，请稍后重试");
  return data;
}

function statusText(preview: IntakePreview) {
  if (preview.understandingState === "READY") return "已形成理解，请整体核对";
  if (preview.understandingState === "FAILED") return preview.model.reason === "UNSUPPORTED_QUOTE" ? "引文没通过原文核对，需要重新生成" : "这次没能形成理解，材料仍然保留";
  if (preview.understandingState === "MATERIAL_ONLY") return "文件还没有可读文本，只能先看原文";
  return "材料已保存，等你让它读懂";
}

export function ProjectIntakeForm({ ownerId, initialDraftId, openDrafts }: { ownerId: string; initialDraftId?: string; openDrafts: DraftSummary[] }) {
  const [draftId, setDraftId] = useState(initialDraftId ?? "");
  const [material, setMaterial] = useState("");
  const [preview, setPreview] = useState<IntakePreview | null>(null);
  const [consent, setConsent] = useState(false);
  const [correction, setCorrection] = useState("");
  const [accepted, setAccepted] = useState({ title: "", description: "", goal: "", scenario: "COURSE_DESIGN", deadline: "" });
  const [busy, setBusy] = useState<"" | "material" | "understand" | "revise" | "confirm" | "sync">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sync, setSync] = useState<{ projectId: string; pending: number; materials: Array<{ materialId: string; state: string; error?: string }> } | null>(null);
  /** 建项成功但材料同步失败：项目身份保留，只重试原同步，不再次建项。 */
  const [syncError, setSyncError] = useState("");
  const [projectId, setProjectId] = useState("");
  const [authRevision, setAuthRevision] = useState(0);
  const mounted = useRef(true);
  const identities = useRef(new Map<string, string>());
  const acceptedDirty = useRef(false);
  function editAccepted(next: typeof accepted) { acceptedDirty.current = true; setAccepted(next); }
  function requestId(key: string) {
    if (!identities.current.has(key)) identities.current.set(key, crypto.randomUUID());
    return identities.current.get(key)!;
  }
  function assertCurrent(epoch: number) {
    if (!mounted.current || epoch !== captureGeneration() || captureOwner() && captureOwner() !== ownerId)
      throw new Error("登录状态已变化，请重新进入原任务");
  }
  useEffect(() => {
    mounted.current = true;
    if (!captureOwner()) bindCaptureDraftOwner(ownerId);
    const off = onCaptureOwnerChange(() => {
      if (!captureOwner() || captureOwner() !== ownerId) {
        setMaterial(""); setCorrection(""); setPreview(null); setDraftId(""); setProjectId(""); setSync(null);
        setConsent(false);
        setAccepted({ title: "", description: "", goal: "", scenario: "COURSE_DESIGN", deadline: "" });
        identities.current.clear();
        acceptedDirty.current = false;
      } else setAuthRevision(n => n+1);
    });
    return () => { mounted.current = false; off(); };
  }, [ownerId]);
  useEffect(() => {
    if (!initialDraftId) return;
    const controller = new AbortController(), epoch = captureGeneration();
    void fetch(`/api/intake/${initialDraftId}`, { cache: "no-store", signal: controller.signal,
      headers: { "X-Expected-Owner-Id": ownerId } }).then(async response => {
      const data = await response.json();
      if (controller.signal.aborted || epoch !== captureGeneration() || captureOwner() && captureOwner() !== ownerId) return;
      if (!response.ok) throw new Error(data?.error?.message ?? "无法读取预览");
      const value = data.preview as IntakePreview, fields = value.accepted ?? value.suggested;
      setDraftId(initialDraftId); setPreview(value); setProjectId(data.confirmedProjectId ?? "");
      setConsent(data.processingConsent === true);
      if (fields && !acceptedDirty.current) setAccepted({ ...fields, deadline: fields.deadline ?? "" });
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [initialDraftId, ownerId, authRevision]);
  async function postJson(url: string, body?: unknown, headers: Record<string, string> = {}) {
    const epoch = captureGeneration();
    assertCurrent(epoch);
    const result = await sendJson(url, body, { "X-Expected-Owner-Id": ownerId, ...headers });
    assertCurrent(epoch);
    return result;
  }

  const canUnderstand = useMemo(() => Boolean(draftId) && (preview?.materials.length ?? 0) > 0, [draftId, preview]);
  const pendingCount = preview?.materials.filter(m => m.sync.state !== "SYNCED").length ?? 0;

  function adopt(previewValue: IntakePreview) {
    setPreview(previewValue);
    const next = previewValue.accepted ?? previewValue.suggested;
    if (next && !acceptedDirty.current) setAccepted({ title: next.title, description: next.description, goal: previewValue.suggested && previewValue.accepted ? previewValue.accepted.goal : next.goal,
      scenario: next.scenario, deadline: next.deadline ?? "" });
  }

  async function ensureDraft() {
    if (draftId) return draftId;
    const created = await postJson("/api/intake", { requestId: requestId("draft") });
    setDraftId(created.draftId);
    window.history.replaceState(null, "", `/projects/new?draft=${created.draftId}`);
    return created.draftId as string;
  }

  async function reload(id: string) {
    if (id !== draftId) acceptedDirty.current = false;
    const epoch = captureGeneration(); assertCurrent(epoch);
    const data = await (await fetch(`/api/intake/${id}`, { cache: "no-store", headers: { "X-Expected-Owner-Id": ownerId } })).json();
    assertCurrent(epoch);
    if (data?.error) throw new Error(data.error.message ?? "无法读取这份材料");
    adopt(data.preview as IntakePreview);
    setConsent(data.processingConsent === true);
    if (data.confirmedProjectId) setProjectId(data.confirmedProjectId);
    return data as { preview: IntakePreview; confirmedProjectId: string | null; processingConsent: boolean };
  }

  async function addMaterial() {
    if (!material.trim()) return;
    setBusy("material"); setError(""); setNotice("");
    try {
      const id = await ensureDraft();
      const text = material.trim();
      await postJson(`/api/intake/${id}/materials`, { requestId: requestId(`text:${id}:${text}`), text });
      setMaterial(current => current.trim() === text ? "" : current);
      await reload(id);
      setNotice("材料已加入。它现在只是预览材料，不是项目目标或授权。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "材料保存失败"); }
    finally { setBusy(""); }
  }

  async function addFile(file: File) {
    setBusy("material"); setError(""); setNotice("");
    try {
      const id = await ensureDraft();
      const form = new FormData();
      form.set("file", file);
      form.set("requestId", requestId(`file:${id}:${file.name}:${file.size}:${file.lastModified}`));
      const epoch = captureGeneration(); assertCurrent(epoch);
      const response = await fetch(`/api/intake/${id}/materials/file`, { method: "POST", body: form, headers: { "X-Expected-Owner-Id": ownerId } });
      const data = await response.json().catch(() => null);
      assertCurrent(epoch);
      if (!response.ok) throw new Error(data?.error?.message ?? "文件保存失败");
      await reload(id);
      setNotice(data?.extractionStatus === "NEEDS_OCR"
        ? "文件已保存，但还没有可靠可读文本；不会假装已经识别。"
        : "文件已保存到临时材料区，确认建项后才会进入项目。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "文件保存失败"); }
    finally { setBusy(""); }
  }

  /** 云处理同意是独立动作：勾选才允许图片识别和生成理解，且只覆盖这份预览。 */
  async function grantConsent(next: boolean) {
    // 先反映用户的选择，再把同意持久化；失败时回退，不让按钮停在假状态。
    setConsent(next); setError("");
    try {
      const id = await ensureDraft();
      await postJson(`/api/intake/${id}/consent`, { consent: next });
      if (!next) await reload(id);
    } catch (reason) {
      setConsent(false);
      if (draftId) await reload(draftId).catch(() => undefined);
      setError(reason instanceof Error ? reason.message : "处理许可状态未确认，请刷新核对");
    }
  }

  async function understand() {
    if (!draftId) return;
    setBusy("understand"); setError(""); setNotice("");
    try {
      await postJson(`/api/intake/${draftId}/understand`, { requestId: requestId(`understand:${draftId}:${preview?.previewHash ?? ""}`), processingConsent: true });
      const data = await reload(draftId);
      adopt(data.preview as IntakePreview);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "这次没能形成理解"); await reload(draftId).catch(() => undefined); }
    finally { setBusy(""); }
  }

  async function revise() {
    if (!draftId || !preview || !correction.trim()) return;
    setBusy("revise"); setError(""); setNotice("");
    try {
      const data = await postJson(`/api/intake/${draftId}/revise`, { requestId: `revise-${crypto.randomUUID()}`,
        text: correction.trim(), expectedRevision: preview.revision });
      setCorrection("");
      adopt(data.preview as IntakePreview);
      if (data.clarify) setNotice(`需要先确认一件事：${data.clarify.question}`);
      else if (data.appliedObjective) setNotice(`已按你的话调整当前范围：${data.appliedObjective}`);
      else setNotice("这句话还只是解释候选，没有改变范围；范围仍按你接受的目标。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "纠正失败"); }
    finally { setBusy(""); }
  }

  async function confirm() {
    if (!draftId || !preview) return;
    setBusy("confirm"); setError(""); setNotice(""); setSync(null); setSyncError("");
    const confirmationId = requestId(`confirm:${draftId}:${preview.revision}:${preview.previewHash}:${JSON.stringify(accepted)}`);
    try {
      const payload = { requestId: confirmationId, expectedRevision: preview.revision, previewHash: preview.previewHash,
        accepted: { title: accepted.title.trim(), description: accepted.description.trim(), goal: accepted.goal.trim(),
          scenario: accepted.scenario as typeof scenarioOptions[number]["value"],
          ...(accepted.deadline ? { deadline: accepted.deadline } : {}) } };
      const data = await postJson(`/api/intake/${draftId}/confirm`, payload, { "Idempotency-Key": confirmationId });
      setProjectId(data.projectId as string);
      // 建项与材料同步是两个阶段：同步失败不清空 projectId，也不重新提交确认。
      try {
        const syncData = await postJson(`/api/intake/${draftId}/sync`);
        setSync(syncData);
        adopt(syncData.preview as IntakePreview);
      } catch (reason) {
        setSyncError(reason instanceof Error ? reason.message : "材料同步失败");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "确认建项失败"); }
    finally { setBusy(""); }
  }

  async function retrySync() {
    if (!draftId) return;
    setBusy("sync"); setError(""); setSyncError("");
    try { const data = await postJson(`/api/intake/${draftId}/sync`); setSync(data); adopt(data.preview as IntakePreview); }
    catch (reason) { setSyncError(reason instanceof Error ? reason.message : "重新同步失败"); }
    finally { setBusy(""); }
  }

  // 建项步骤只反映当前已发生的状态：无材料 → 放材料；有材料未形成理解 → 看它读懂了什么；理解已形成 → 整体纠正；已建项 → 确认建项。
  const step = projectId ? 4 : !preview || preview.materials.length === 0 ? 1 : preview.understandingState === "READY" ? 3 : 2;
  return <div className="mt-8 space-y-6">
    <ol aria-label="建项步骤" className="flex flex-wrap gap-2 text-xs">
      {["放材料", "看它读懂了什么", "整体纠正", "确认建项"].map((label, index) => <li key={label} aria-current={index + 1 === step ? "step" : undefined}
        className={"inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 " + (index + 1 === step ? "border-[var(--teal)] bg-[var(--teal-pale)] font-bold text-[var(--teal-strong)]" : index + 1 < step ? "border-[var(--rule)] text-[var(--ink-soft)]" : "border-[var(--rule)] text-[var(--muted)]")}>
        <span className="font-mono">{index + 1}</span>{label}</li>)}
    </ol>
    {openDrafts.length > 0 && !draftId && <section className="card-surface rounded-lg p-5" aria-label="继续未完成的材料预览">
      <p className="archive-label">继续上次的材料</p>
      <div className="mt-3 space-y-2">
        {openDrafts.map(draft => <button key={draft.id} onClick={async () => {
          setDraftId(draft.id); window.history.replaceState(null, "", `/projects/new?draft=${draft.id}`);
          await reload(draft.id).catch(reason => setError(reason.message));
        }} className="focus-ring flex w-full items-center justify-between rounded-md border border-[var(--rule)] px-4 py-3 text-left text-sm hover:border-[var(--navy)]">
          <span>{draft.understandingState === "READY" ? "已读懂，等待核对" : "材料已保存，等待理解"}</span>
          <span className="text-xs text-[var(--muted)]">第 {draft.revision} 版 · {new Date(draft.expiresAt).toLocaleDateString()}</span>
        </button>)}
      </div>
    </section>}

    <section className="card-surface rounded-lg p-6 sm:p-8" aria-label="项目材料">
      <div className="border-b archive-rule pb-5">
        <p className="archive-label">第一步 · 放材料</p>
        <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">粘贴要求、记录或计划，也可以加一份 PDF／图片。先不用整理成完整目标。</p>
      </div>
      <label htmlFor="intake-material" className="mt-5 block text-sm font-bold">材料正文</label>
      <textarea id="intake-material" value={material} onChange={event => setMaterial(event.target.value)} rows={7}
        className={fieldClass} placeholder="把课程要求、实验记录、群里的通知或自己的计划直接贴进来。" />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={addMaterial} disabled={!material.trim() || busy === "material"} className="focus-ring editorial-button-secondary disabled:opacity-60">
          {busy === "material" ? <LoaderCircle className="animate-spin" size={16} /> : <FileText size={16} />} 加入材料
        </button>
        <label className="focus-ring editorial-button-secondary cursor-pointer">
          <Paperclip size={16} /> 加一个文件
          <input type="file" accept=".pdf,image/*" className="sr-only" onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void addFile(file);
          }} />
        </label>
      </div>
      {preview && preview.materials.length > 0 && <ul className="mt-5 space-y-2" aria-label="已加入的材料">
        {preview.materials.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--rule)] px-3 py-2 text-sm">
          <span>{item.label}{item.type ? ` · ${item.type}` : ""}</span>
          <span className="text-xs text-[var(--muted)]">
            {item.extractionStatus === "PENDING" ? "原件已保存，解析中" : item.extractionStatus === "NEEDS_OCR" ? "没有可读文本" : item.extractionStatus === "FAILED" ? "抽取失败" : "已保存"}
            {item.sync.state === "SYNCED" ? " · 已进入项目" : ""}
          </span>
        </li>)}
      </ul>}
    </section>

    <section className="card-surface rounded-lg p-6 sm:p-8" aria-label="项目理解">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b archive-rule pb-5">
        <div>
          <p className="archive-label">第二步 · 看它读懂了什么{preview && preview.understandingState === "READY" ? ` · 项目理解第 ${preview.revision} 版` : ""}</p>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{preview ? statusText(preview) : "加入材料后，让 Agent 说出它对项目的理解。"}</p>
        </div>
        <button onClick={understand} disabled={!canUnderstand || !consent || busy === "understand"} className="focus-ring editorial-button disabled:opacity-60">
          {busy === "understand" ? <LoaderCircle className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
          {preview?.understandingState === "READY" ? "重新读懂材料" : "读懂这些材料"}
        </button>
      </div>
      <label className="mt-4 flex items-start gap-2 text-xs leading-5 text-[var(--muted)]">
        <input type="checkbox" checked={consent} onChange={event => { void grantConsent(event.target.checked); }} className="focus-ring mt-0.5" />
        <span>允许把这次的材料交给云模型处理一次。它只用于这份预览：不建立项目、不获得工具权限，也不写入长期记忆。</span>
      </label>

      {preview && preview.materials.length > 0 && <IntakeCoveragePanel key={`${draftId}:${preview.materialsHash}:${preview.status}`} draftId={draftId} coverage={preview.coverage} materials={preview.materials} />}

      {preview && preview.understandingState === "READY" && <>
        {preview.summary && <p className="mt-5 leading-7">{preview.summary}</p>}
        <div className="mt-6 space-y-4">
          <div>
            <p className="archive-label">材料明确说了</p>
            <ul className="mt-2 space-y-3">
              {preview.statements.map((statement, index) => <li key={`${statement.materialId}-${index}`} className="rounded-md border-l-2 border-[var(--teal-strong)] bg-[var(--surface)] px-4 py-3">
                <p className="text-sm leading-6">“{statement.quote}”</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{statement.materialLabel} · {statement.meaning}</p>
              </li>)}
            </ul>
          </div>
          <div>
            <p className="archive-label">Agent 的建议（还不是目标）</p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex gap-2"><dt className="shrink-0 text-[var(--muted)]">名称</dt><dd>{preview.suggested?.title}</dd></div>
              <div className="flex gap-2"><dt className="shrink-0 text-[var(--muted)]">目标</dt><dd>{preview.suggested?.goal}</dd></div>
            </dl>
          </div>
          {(preview.constraints.length > 0 || preview.unknowns.length > 0) && <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="archive-label">条件与限制</p>
              <ul className="mt-2 space-y-1 text-sm">
                {preview.constraints.map((item, index) => <li key={index}>{item.text}
                  <span className="ml-2 text-xs text-[var(--muted)]">{item.basis === "STATED" ? "材料原文" : "推断"}</span></li>)}
              </ul>
            </div>
            <div>
              <p className="archive-label">还不知道</p>
              <ul className="mt-2 space-y-1 text-sm">
                {preview.unknowns.map((item, index) => <li key={index}>{item.text}
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">{item.whyItMatters}</span></li>)}
              </ul>
            </div>
          </div>}
          {preview.nextQuestion && <div>
            <p className="archive-label">下一步最值得查清</p>
            <p className="mt-2 text-sm">{preview.nextQuestion.text}<span className="mt-0.5 block text-xs text-[var(--muted)]">{preview.nextQuestion.why}</span></p>
          </div>}
        </div>
      </>}

      {preview && preview.understandingState !== "READY" && preview.statements.length > 0 && <div className="mt-5">
        <p className="archive-label">材料原文片段</p>
        <ul className="mt-2 space-y-2">
          {preview.statements.map((statement, index) => <li key={index} className="rounded-md bg-[var(--surface)] px-4 py-3 text-sm">
            “{statement.quote}”<span className="mt-1 block text-xs text-[var(--muted)]">{statement.materialLabel}</span>
          </li>)}
        </ul>
      </div>}
    </section>

    {preview && <section className="card-surface rounded-lg p-6 sm:p-8" aria-label="整体纠正">
      <p className="archive-label">第三步 · 整体纠正</p>
      <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">用一句话说明应该先做什么。明确、在范围内的要求会直接生效；含糊的会留成待确认的解释。</p>
      <textarea value={correction} onChange={event => setCorrection(event.target.value)} rows={3} className={fieldClass}
        placeholder="例如：本周先确认设备可用性" />
      <button onClick={revise} disabled={!correction.trim() || busy === "revise"} className="focus-ring editorial-button-secondary mt-4 disabled:opacity-60">
        {busy === "revise" ? <LoaderCircle className="animate-spin" size={16} /> : <ArrowRight size={16} />} 按这句话调整
      </button>
      {preview.correction.appliedObjective && <p className="mt-4 rounded-md bg-[var(--teal-pale)] px-4 py-3 text-sm">
        当前范围：{preview.correction.appliedObjective}{preview.correction.until ? `（到 ${new Date(preview.correction.until).toLocaleString()}）` : ""}
      </p>}
      {preview.correction.candidates.length > 0 && <div className="mt-4 rounded-md border border-[var(--rule)] px-4 py-3">
        <p className="text-xs font-bold text-[var(--ink-soft)]">还没有生效的解释</p>
        <ul className="mt-1 space-y-1 text-sm">{preview.correction.candidates.map((candidate, index) => <li key={index}>“{candidate.quote}”</li>)}</ul>
      </div>}
      {preview.correction.clarify && <p role="status" className="mt-4 rounded-md bg-[var(--brick-pale)] px-4 py-3 text-sm text-[var(--brick)]">{preview.correction.clarify.question}</p>}
    </section>}

    {preview && <section className="card-surface rounded-lg p-6 sm:p-8" aria-label="确认项目">
      <p className="archive-label">第四步 · 确认建项</p>
      <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">下面是写进项目的字段。改过再确认也来得及，确认前不会创建项目。</p>
      <div className="mt-5 grid gap-5">
        <div><label htmlFor="intake-title" className="text-sm font-bold">项目名称</label>
          <input id="intake-title" value={accepted.title} onChange={event => editAccepted({ ...accepted, title: event.target.value })} className={fieldClass} /></div>
        <div><label htmlFor="intake-description" className="text-sm font-bold">项目描述</label>
          <textarea id="intake-description" value={accepted.description} onChange={event => editAccepted({ ...accepted, description: event.target.value })} rows={3} className={fieldClass} /></div>
        <div><label htmlFor="intake-goal" className="text-sm font-bold">项目目标</label>
          <textarea id="intake-goal" value={accepted.goal} onChange={event => editAccepted({ ...accepted, goal: event.target.value })} rows={3} className={fieldClass} /></div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div><label htmlFor="intake-scenario" className="text-sm font-bold">场景</label>
            <select id="intake-scenario" value={accepted.scenario} onChange={event => editAccepted({ ...accepted, scenario: event.target.value })} className={fieldClass}>
              {scenarioOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select></div>
          <div><label htmlFor="intake-deadline" className="text-sm font-bold">截止日期<span className="font-normal text-[var(--muted)]">（可选）</span></label>
            <input id="intake-deadline" type="date" value={accepted.deadline} onChange={event => editAccepted({ ...accepted, deadline: event.target.value })} className={fieldClass} /></div>
        </div>
      </div>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {!projectId && <Link href="/projects" className="focus-ring editorial-button-secondary">先不建</Link>}
        {!projectId && <button onClick={confirm} disabled={busy === "confirm" || preview.materials.length === 0} className="focus-ring editorial-button disabled:opacity-60">
          {busy === "confirm" ? <LoaderCircle className="animate-spin" size={18} /> : <ArrowRight size={18} />}
          {busy === "confirm" ? "正在建立项目…" : "确认理解，建立项目"}
        </button>}
        {projectId && <div className="w-full">
          {sync ? <>
            <p className="rounded-md bg-[var(--teal-pale)] px-4 py-3 text-sm">
              项目已建立，材料已同步 {sync.materials.filter(m => m.state === "SYNCED").length}/{sync.materials.length} 份。
              {sync.pending > 0 ? "还有材料没同步完成；项目已经存在，可以稍后重试，不会重复建项。" : ""}
            </p>
            {syncError && <p role="alert" className="mt-2 rounded-md bg-[var(--brick-pale)] px-4 py-3 text-sm text-[var(--brick)]">重新同步失败：{syncError}；项目身份不变，可继续重试原同步。</p>}
          </> : <p role="alert" className="rounded-md bg-[var(--brick-pale)] px-4 py-3 text-sm text-[var(--brick)]">
            项目已建立，{syncError ? `但材料同步失败：${syncError}` : "材料同步结果尚未确认"}。项目身份已保留，重试只同步原材料，不会重复建项。
          </p>}
          <div className="mt-3 flex flex-wrap gap-3">
            {(!sync || sync.pending > 0) && <button onClick={retrySync} disabled={busy === "sync"} className="focus-ring editorial-button-secondary">
              {busy === "sync" ? <LoaderCircle className="animate-spin" size={16} /> : null} 重新同步材料
            </button>}
            <a href={`/projects/${projectId}`} className="focus-ring editorial-button">进入项目<ArrowRight size={16} /></a>
          </div>
          {/* 建项后才出现下一步；只链到现有项目页/委托入口，不再建项目或重建确认步骤。 */}
          <div className="mt-4 border-t border-[var(--rule)] pt-3">
            <p className="text-sm font-bold">下一步</p>
            <ul className="mt-2 space-y-1 text-sm">
              <li><a className="workspace-link focus-ring" href={`/projects/${projectId}`}>核对目标与范围 →</a></li>
              <li><a className="workspace-link focus-ring" href={`/projects/${projectId}/records`}>查看材料与未知 →</a></li>
              <li><a className="workspace-link focus-ring" href={`/projects/${projectId}/missions`}>开始原调查 →</a></li>
            </ul>
            {preview?.model.used !== true && <p className="mt-2 text-xs text-[var(--muted)]">材料已保存；这次没有启用真实模型，只做了规则整理，未声称已理解全文。</p>}
          </div>
        </div>}
      </div>
      {pendingCount > 0 && !projectId && <p className="mt-3 text-xs text-[var(--muted)]">确认后材料才会进入项目；同步结果会逐份显示。</p>}
    </section>}

    {error && <p role="alert" className="rounded-md bg-[var(--brick-pale)] px-4 py-3 text-sm font-medium text-[var(--brick)]">{error}</p>}
    {notice && <p role="status" className="rounded-md bg-[var(--surface)] px-4 py-3 text-sm">{notice}</p>}
  </div>;
}



