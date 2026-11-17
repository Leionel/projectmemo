"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, BookOpen, Check, ChevronRight, FileText, GitCompareArrows, RefreshCw } from "lucide-react";
import { AgentMessageBlocks } from "@/components/AgentMessageBlocks";
import { workbenchFixture } from "@/lib/experience/workbenchFixture";
import { workbenchArtifactMessage, workbenchMessage, type WorkbenchSnapshot } from "@/lib/types/workbench";
import styles from "./OutcomeWorkbench.module.css";
import { MissionMaterialForm } from "./MissionMaterialForm";
import { OutcomeChallenges } from "./OutcomeChallenges";

async function api(url: string, body?: unknown) {
  const response = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : value.error?.message ?? "暂时无法读取，请重试原请求");
  return value;
}
const phaseLabels: Record<string, string> = { WAITING_OBSERVATION: "稿件已备好，继续留意变化", QUEUED: "已接到工作，等待后台推进",
  RUNNING: "正在处理获准资料", WAITING_USER: "有一个判断需要你", PAUSED: "跟进已暂停", COMPLETED: "跟进已结束", UNKNOWN: "当前状态需核对" };
type Pending = { conversationId: string; body: Record<string, unknown> };
export function OutcomeWorkbench({ missionId }: { missionId?: string }) {
  const live = !!missionId;
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(() => live ? null : workbenchFixture());
  const [research, setResearch] = useState(false), [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [view, setView] = useState<"draft" | "diff">("draft"), [sourceKey, setSourceKey] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [game, setGame] = useState<"mentor" | "evidence" | "sprint" | null>(null);
  const [chosen, setChosen] = useState(""), [answer, setAnswer] = useState(""), [sprinting, setSprinting] = useState(false);
  const [sprintChecked, setSprintChecked] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const pending = useRef<Pending | null>(null), conversationId = useRef<string | null>(null);
  useEffect(() => {
    if (!missionId) return;
    let active = true;
    const refresh = async () => {
      try { const value = await api("/api/missions/" + encodeURIComponent(missionId) + "/workbench"); if (active) setSnapshot(value); }
      catch (e) { if (active) setError(e instanceof Error ? e.message : "读取失败"); }
    };
    void refresh(); const interval = setInterval(() => void refresh(), 2500);
    return () => { active = false; clearInterval(interval); };
  }, [missionId]);
  async function refresh() {
    if (!missionId) return;
    try { setSnapshot(await api("/api/missions/" + encodeURIComponent(missionId) + "/workbench")); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "读取失败"); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || !message.trim() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (!live) {
        const quoted = message.trim(), restricted = /不联网|不要联网/.test(quoted), paused = /^(暂停|停止)/.test(quoted);
        setSnapshot({ ...snapshot, workingObjective: quoted, phase: paused ? "PAUSED" : snapshot.phase,
          reason: paused ? "样例跟进已暂停" : restricted ? "样例：保持原成果，后续只使用本地资料" : "样例：已记录新的工作重点",
          events: [{ id: crypto.randomUUID(), label: "样例：收到你的改道输入", at: new Date().toISOString() }, ...snapshot.events] });
        setNotice("样例交互已更新；没有写入真实项目。");
      } else {
        if (!pending.current) {
          if (!conversationId.current) {
            const created = await api("/api/conversations", { requestId: crypto.randomUUID(), scope: "PROJECT",
              projectId: snapshot.projectId, title: "成果工作台" });
            conversationId.current = created.id;
          }
          const c = await api("/api/conversations/" + conversationId.current);
          pending.current = { conversationId: c.id, body: { requestId: crypto.randomUUID(), expectedVersion: c.version,
            expectedContinuitySeq: c.continuity?.seq ?? 0, message: message.trim(), projectId: snapshot.projectId,
            entityRef: { kind: "MISSION", id: snapshot.id, projectId: snapshot.projectId } } };
          setHasPending(true);
        }
        const request = pending.current;
        await api("/api/conversations/" + request.conversationId + "/turns", request.body);
        pending.current = null; setHasPending(false); await refresh();
        setNotice("输入已送达原委托的对话控制链；应用结果以当前状态为准。");
      }
      setMessage("");
    } catch (e) { setError(e instanceof Error ? e.message : "提交未确认，请重试原请求"); }
    finally { setBusy(false); }
  }
  async function control(action: "pause" | "cancel" | "resume") {
    if (!snapshot || busy) return;
    setBusy(true); setError("");
    try {
      // Controls bind to the current persisted version, not the last poll snapshot.
      const detail = await api("/api/missions/" + encodeURIComponent(snapshot.id));
      const current = detail.mission ?? detail;
      await api("/api/missions/" + encodeURIComponent(snapshot.id) + "/" + action, { requestId: crypto.randomUUID(), expectedVersion: current.version });
      setConfirmingEnd(false); setNotice(action === "pause" ? "已收到暂停请求，后台不再派发新步骤。" : action === "resume" ? "已恢复跟进；阶段成果与原报告都保留。" : "已结束持续跟进；已交付版本与依据仍然保留。");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "操作未确认，请重试"); }
    finally { setBusy(false); }
  }
  function switchSample(value: boolean) {
    setResearch(value); setSnapshot(workbenchFixture(1, value)); setSelectedRevision(null); setSourceKey(null);
    setChosen(""); setNotice(""); setAnswer(""); setSprintChecked(false); setSprinting(false);
  }
  if (!snapshot) return <main className={styles.loading}><h1>成果工作台</h1><p role="status">{error || "正在读取原委托…"}</p>
    {error && <><button onClick={() => void refresh()}>重试读取</button><a href="/login">登录后继续</a></>}</main>;
  const output = snapshot.outputs.find(o => o.revision === selectedRevision) ?? snapshot.outputs[0];
  const artifact = snapshot.stageArtifacts.find(item => item.id === selectedArtifactId) ?? snapshot.stageArtifacts[0];
  const stageReady = snapshot.reasonCode === "SKILL_DELIVERABLE_READY";
  const previous = output ? snapshot.outputs.find(o => o.revision < output.revision) : undefined;
  const source = snapshot.sources.find(s => s.key === sourceKey) ??
    snapshot.sources.find(s => output?.sourceKeys.includes(s.key)) ?? snapshot.sources[0];
  const currentSourceIds = output?.blocks.flatMap(b => b.sourceIds) ?? [];
  function prepareQuestion(text: string) { setMessage("今天先核对" + text); setNotice("已放入下方输入框，发送后交给原委托。"); }
  return <main className={styles.workbench}>
    <div className={styles.topline}><a href="/focus">忆程 <ChevronRight size={14} aria-hidden="true" /> 成果工作台</a>
      <span>{live ? (snapshot.provider.startsWith("INJECTED") ? "隔离流程演示 · 注入模型" : "原委托实时读回") : "可点击交互样例 · 未运行模型"}</span></div>
    <header className={styles.heading}><div><p>{snapshot.projectTitle}</p><h1>{snapshot.goal}</h1>
      <div className={styles.state} role="status"><span aria-hidden="true" className={styles.dot} />
        {stageReady ? snapshot.reason : phaseLabels[snapshot.phase] ?? snapshot.reason}</div></div>
      {live ? <div className={styles.controls}><button className={styles.secondary} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true" />重新读取</button>{stageReady && <button className={styles.secondary} disabled={busy} onClick={() => void control("resume")}>继续跟进</button>}<button className={styles.secondary} disabled={busy || snapshot.status !== "READY" && snapshot.phase !== "WAITING_OBSERVATION"} onClick={() => void control("pause")}>暂停跟进</button><button className={styles.secondary} disabled={busy} onClick={() => void (confirmingEnd ? control("cancel") : setConfirmingEnd(true))}>{confirmingEnd ? "确认结束跟进" : "结束跟进"}</button></div> :
        <div className={styles.sampleChoices}><button aria-pressed={!research} onClick={() => switchSample(false)}>开发样例</button>
          <button aria-pressed={research} onClick={() => switchSample(true)}>科研对照</button></div>}
    </header>
    {!live && <div className={styles.sampleBar}><p>用一条新资料体验同一份成果的接续修改。</p><button className={styles.secondary}
      disabled={snapshot.outputs.length >= 2} onClick={() => { setSnapshot(workbenchFixture(2, research)); setSelectedRevision(null); setSourceKey(null); }}>
      载入新资料样例 <ArrowUpRight size={15} aria-hidden="true" /></button></div>}
    {error && <div role="alert" className={styles.error}>{error}{hasPending && "；原请求编号已保留，再次发送会重试原请求。"}</div>}
    <div className={styles.workspace}>
      <aside className={styles.progress} aria-label="Agent过程反馈"><h2>这份成果的进展</h2>
        <p className={styles.objective}>{snapshot.workingObjective}</p>
        <ol>{snapshot.events.slice(0, 8).map(event => <li key={event.id}><Check size={13} aria-hidden="true" /><div>{event.label}
          <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" })}</time></div></li>)}</ol>
        <div className={styles.usage}>{live ? <><span>模型调用 {snapshot.models}</span><span>工具调用 {snapshot.tools}</span></> : "样例操作不会调用模型"}
          <small>{live ? "读取时间" : "样例时点"} {new Date(snapshot.checkedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）</small></div>
      </aside>
      <section className={styles.document} aria-label="项目成果">
        {artifact && <section className={styles.stageArtifacts} aria-label="阶段成果">
          <div className={styles.documentHead}><div className={styles.views}><h2><FileText size={15} aria-hidden="true" />阶段成果</h2></div>
            <div className={styles.versions} aria-label="阶段成果列表">{snapshot.stageArtifacts.map(item => <button key={item.id}
              aria-pressed={item.id === artifact.id} onClick={() => { setSelectedArtifactId(item.id); setSourceKey(null); }}>{item.label}</button>)}</div></div>
          <p className={styles.paperLabel}>{artifact.label} · 原报告与业务行动未改动</p>
          <AgentMessageBlocks message={workbenchArtifactMessage(artifact, snapshot.projectId, snapshot.provider)}
            conversationId={"workbench-artifact-" + snapshot.id} busy={busy} onAction={async () => { /* Read-only presentation has no business actions. */ }} />
          <div className={styles.references}><span>本阶段依据</span>{[...new Set(artifact.blocks.flatMap(block => block.sourceIds))].map(id => {
            const found = snapshot.sources.find(item => item.id === id && artifact.sourceKeys.includes(item.key));
            return found ? <button key={id} onClick={() => setSourceKey(found.key)}><BookOpen size={14} aria-hidden="true" />定位原记录{found.name ? " · " + found.name : ""}</button> : null;
          })}{artifact.unknowns.length > 0 && <p>仍未知：{artifact.unknowns.join("；")}</p>}</div>
        </section>}
        <div className={styles.documentHead}><div className={styles.views}>
          <button aria-pressed={view === "draft"} onClick={() => setView("draft")}><FileText size={15} aria-hidden="true" />成果</button>
          <button aria-pressed={view === "diff"} onClick={() => setView("diff")}><GitCompareArrows size={15} aria-hidden="true" />修改对照</button></div>
          <div className={styles.versions} aria-label="成果版本">{snapshot.outputs.map(o => <button key={o.id}
            aria-pressed={output?.id === o.id} onClick={() => { setSelectedRevision(o.revision); setSourceKey(null); }}>第 {o.revision} 版</button>)}</div>
        </div>
        {output ? <div className={styles.paper}>
          <p className={styles.paperLabel}>私有工作稿 · 第 {output.revision} 版</p>
          {view === "draft" ? <AgentMessageBlocks message={workbenchMessage(output, snapshot.projectId, snapshot.provider)}
            conversationId={"workbench-view-" + snapshot.id} busy={busy} onAction={async () => { /* Read-only presentation has no business actions. */ }} /> :
            previous ? <div className={styles.diff}><h2>第 {previous.revision} 版 → 第 {output.revision} 版</h2>
              {previous.blocks.filter(old => !output.blocks.some(b => b.blockId === old.blockId)).map(old =>
                <del key={old.blockId}><span>已移除</span>{old.text}</del>)}
              {output.blocks.map(block => {
                const old = previous.blocks.find(b => b.blockId === block.blockId);
                return <div key={block.blockId}>{old?.text === block.text ? <p>{block.text}</p> :
                  <>{old && <del><span>原稿</span>{old.text}</del>}<ins><span>当前稿</span>{block.text}</ins></>}</div>;
              })}</div> : <p className={styles.empty}>当前只有一版成果。新资料更新后，可在这里比较。</p>}
          <div className={styles.references}><span>本稿依据</span>{currentSourceIds.length ? [...new Set(currentSourceIds)].map(id => {
            const found = snapshot.sources.find(s => s.id === id && output.sourceKeys.includes(s.key));
            return found ? <button key={id} onClick={() => setSourceKey(found.key)}><BookOpen size={14} aria-hidden="true" />定位原记录{found.name ? " · " + found.name : ""}</button> : null;
          }) : <p>这版内容仅为推断或来源需要重新核对。</p>}</div>
        </div> : <p className={styles.empty}>原委托还没有生成报告稿。阶段成果与后台过程保留在本次读取中。</p>}
        {!live && <div className={styles.games}><span>围绕这份成果试一试</span>
          <button aria-pressed={game === "mentor"} onClick={() => setGame(game === "mentor" ? null : "mentor")}>严格导师</button>
          <button aria-pressed={game === "evidence"} onClick={() => setGame(game === "evidence" ? null : "evidence")}>证据侦探</button>
          <button aria-pressed={game === "sprint"} onClick={() => setGame(game === "sprint" ? null : "sprint")}>双人冲刺</button></div>}
        {!live && game && <section className={styles.game} aria-label="成果挑战">
          {game === "mentor" && <><h2>交付前，先回答这三个追问</h2><ol><li>这份稿中，哪一句能直接定位到原记录？</li>
            <li>哪一个条件仍然未知，不能写成结论？</li><li>新资料改变了哪一处交付判断？</li></ol>
            <label htmlFor="mentor-answer">记下这份成果的缺口</label><textarea id="mentor-answer" value={answer} onChange={e => setAnswer(e.target.value)} maxLength={500} />
            <button className={styles.secondary} disabled={!answer.trim()} onClick={() => prepareQuestion(answer)}>交给原委托核查</button></>}
          {game === "evidence" && <><h2>找到这版成果真正引用的记录</h2><p>{output?.blocks[0]?.text ?? "先准备一版成果再开始。"}</p>
            <div className={styles.evidenceChoices}>{snapshot.sources.map(s => <button key={s.key} aria-pressed={chosen === s.key}
              onClick={() => { setChosen(s.key); setSourceKey(s.key); }}>{s.text.slice(0, 70)}</button>)}</div>
            {chosen && <p role="status">{output?.sourceKeys.includes(chosen)
              ? "这份记录出现在本稿引用中。引用关系不等于结论已经被验证。" : "这份记录没有出现在当前版本的引用中，可对照另一版查看。"}</p>}</>}
          {game === "sprint" && <><h2>你核对一处依据，忆程保持原委托的工作</h2>
            <p>你的工作：读右侧记录，找出一项需要核对的条件。</p><p>Agent当前：{snapshot.reason}</p>
            <button className={styles.secondary} onClick={() => setSprinting(!sprinting)}>{sprinting ? "结束本次分工" : "开始这次分工"}</button>
            {sprinting && <label className={styles.checkbox}><input type="checkbox" checked={sprintChecked} onChange={e => setSprintChecked(e.target.checked)} />我已核对原记录</label>}
            {sprintChecked && <p>已记下你的自述；这不会把项目行动标记为完成。</p>}</>}
        </section>}
        {live && snapshot.challengesEnabled && <OutcomeChallenges missionId={snapshot.id} outputId={output?.id} onSource={setSourceKey} onHandoff={refresh} />}
        {live && <MissionMaterialForm missionId={snapshot.id} projectId={snapshot.projectId} onSaved={refresh} />}
        <form className={styles.composer} onSubmit={submit}><label htmlFor="workbench-message">接下来怎么做，直接告诉忆程</label>
          <textarea id="workbench-message" value={message} disabled={busy || hasPending} onChange={e => setMessage(e.target.value)}
            placeholder="例如：继续整理，但不要联网" maxLength={3000} required />
          <div><span>修改工作方向，保留已有成果和用量。</span><button type="submit" className={styles.primary} disabled={busy || !message.trim()}>
            {busy ? "正在提交…" : hasPending ? "重试原请求" : "发送"}<ArrowUpRight size={16} aria-hidden="true" /></button></div>
        </form>
        {notice && <p role="status" className={styles.notice}>{notice}</p>}
      </section>
      <aside className={styles.source} aria-label="证据定位"><div><BookOpen size={17} aria-hidden="true" /><h2>原始依据</h2></div>
        {source ? <><p className={styles.sourceKind}>{source.name ?? (source.kind === "PROJECT" ? "项目记录" : "外部参考")} · {source.current ? "当前引用版本" : "历史冻结版本"}</p>
          <blockquote data-testid="source-excerpt">{source.text}</blockquote><details><summary>来源与版本</summary><dl><dt>来源</dt><dd>{source.id}</dd>
            <dt>版本</dt><dd>{source.revision}</dd><dt>指纹</dt><dd>{source.hash}</dd></dl></details></> : <p>尚无可用引用，或来源使用许可需要重新核对。</p>}
      </aside>
    </div>
  </main>;
}
