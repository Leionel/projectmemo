"use client";
import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import styles from "./ConversationPanel.module.css";

export type ConversationAttachmentChip = { id: string; fileName: string; extractionStatus: string; extractionError: string | null };
type Choice = { file: File } | null;

async function upload<T>(url: string, file: File, extra: Record<string, string> = {}): Promise<T> {
  const form = new FormData(); form.append("file", file);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const response = await fetch(url, { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message ?? "附件上传失败");
  return data as T;
}

/**
 * 讨论附件：选文件后二选一——仅用于本次讨论（不进项目记忆），或加入项目资料（按项目附件原流程生成待核对记忆）。
 * 加入项目资料需要先选定项目；跨项目讨论里的图片按当前选中项目计识别额度，没选项目时只保存原件。
 */
export function useConversationAttachments({ conversationId, projectId, disabled, chips, onChips, onProjectSaved, onError }: {
  conversationId: string; projectId: string; disabled: boolean;
  chips: ConversationAttachmentChip[]; onChips: (chips: ConversationAttachmentChip[]) => void;
  onProjectSaved: (fileName: string) => void; onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [choice, setChoice] = useState<Choice>(null), [busy, setBusy] = useState(false);
  async function keepInConversation(file: File) {
    setBusy(true);
    try {
      const { attachment } = await upload<{ attachment: ConversationAttachmentChip }>(`/api/conversations/${conversationId}/attachments`, file, projectId ? { projectId } : {});
      if (!chips.some(c => c.id === attachment.id)) onChips([...chips, attachment]);
    } catch (error) { onError(error instanceof Error ? error.message : "附件上传失败"); }
    finally { setBusy(false); setChoice(null); }
  }
  async function saveToProject(file: File) {
    if (!projectId) return;
    setBusy(true);
    try { await upload(`/api/projects/${projectId}/attachments`, file); onProjectSaved(file.name); }
    catch (error) { onError(error instanceof Error ? error.message : "附件上传失败"); }
    finally { setBusy(false); setChoice(null); }
  }
  async function promote(chip: ConversationAttachmentChip) {
    if (!projectId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/attachments/${chip.id}/promote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message ?? "转为项目资料失败");
      onChips(chips.filter(c => c.id !== chip.id)); onProjectSaved(chip.fileName);
    } catch (error) { onError(error instanceof Error ? error.message : "转为项目资料失败"); }
    finally { setBusy(false); }
  }
  async function remove(chip: ConversationAttachmentChip) {
    onChips(chips.filter(c => c.id !== chip.id));
    await fetch(`/api/conversations/${conversationId}/attachments/${chip.id}`, { method: "DELETE" }).catch(() => undefined);
  }
  // 回形针放在输入框底栏左侧；用途选择和本轮附件仍显示在输入框上方。
  const button = <>
    <input ref={input} type="file" accept=".pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp" className="sr-only" tabIndex={-1}
      onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) setChoice({ file }); }}/>
    <button type="button" className={styles.attachButton + " focus-ring"} aria-label="添加附件" title="添加附件" disabled={disabled || busy} onClick={() => input.current?.click()}><Paperclip size={16} aria-hidden="true"/></button>
  </>;
  const panel = <>
    {choice && <div role="dialog" aria-label="附件用途" className={styles.attachChoice}>
      <p>《{choice.file.name}》用于</p>
      <button type="button" className="focus-ring" disabled={busy} onClick={() => void keepInConversation(choice.file)}><strong>仅用于本次讨论</strong><span>不进入项目记忆，可随时转为项目资料</span></button>
      <button type="button" className="focus-ring" disabled={busy || !projectId} onClick={() => void saveToProject(choice.file)}><strong>加入项目记忆</strong><span>{projectId ? "保存为项目资料并生成待核对的记忆" : "先在下方选择一个项目"}</span></button>
      <button type="button" className="workspace-link focus-ring" onClick={() => setChoice(null)}>取消</button>
    </div>}
    {chips.length > 0 && <ul className={styles.attachChips} aria-label="本轮附件">
      {chips.map(chip => <li key={chip.id}>
        <span className={styles.attachName}>{chip.fileName}</span>
        {chip.extractionStatus !== "SUCCESS" && <span className={styles.attachHint} title={chip.extractionError ?? undefined}>{chip.extractionError?.includes("未选择项目") ? "图片暂未识别文字" : "文字待提取"}</span>}
        {projectId && <button type="button" className="workspace-link focus-ring" disabled={busy} onClick={() => void promote(chip)}>转为项目资料</button>}
        <button type="button" className={styles.attachRemove + " focus-ring"} aria-label={"移除附件 " + chip.fileName} onClick={() => void remove(chip)}><X size={13} aria-hidden="true"/></button>
      </li>)}
    </ul>}
  </>;
  return { button, panel };
}
