"use client";
import { useRef, useState, type ChangeEvent } from "react";

export function MaterialInput({ value, name, projectId, onChange, onReadingChange, disabled = false, required = true, label = "导入文本材料" }: {
  value: string; name?: string; projectId: string; onChange: (text: string, name?: string) => void; onReadingChange?: (reading: boolean) => void; disabled?: boolean; required?: boolean; label?: string;
}) {
  const revision = useRef(0), [error, setError] = useState(""), [reading, setReading] = useState(false);
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0], current = ++revision.current;
    event.target.value = "";
    if (!file) return;
    setReading(true); onReadingChange?.(true);
    try {
      const rich = /\.(docx|xlsx)$/i.test(file.name);
      if (!/\.(txt|md|csv|docx|xlsx)$/i.test(file.name) || file.size > (rich ? 2 * 1024 * 1024 : 65536)) throw new Error("支持 2MB 以内的 DOCX/XLSX，以及 64KB 以内的 TXT、Markdown、CSV");
      let text: string;
      if (rich) {
        const body = new FormData(); body.append("file", file);
        const response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/material-extract", { method: "POST", body });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error?.message ?? "文件提取失败，请重试");
        text = value.text;
      } else text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (text.length > 20000) throw new Error("材料不能超过 2 万字");
      if (current !== revision.current) return;
      onChange(text, file.name); setError("");
    } catch (cause) {
      if (current === revision.current) setError(cause instanceof TypeError ? "请将文件保存为 UTF-8 编码后重新导入" : cause instanceof Error ? cause.message : "文件读取失败");
    } finally {
      if (current === revision.current) { setReading(false); onReadingChange?.(false); }
    }
  }
  return <>
    <label>{label}<textarea value={value} maxLength={20000} disabled={disabled || reading} required={required} rows={4}
      onChange={event => { revision.current++; setError(""); onChange(event.target.value, name); }} /></label>
    <label>从文件导入<input type="file" aria-label="导入材料文件" accept=".txt,.md,.csv,.docx,.xlsx" disabled={disabled || reading} onChange={event => void importFile(event)} /></label>
    {reading && <p role="status">正在提取材料…</p>}
    {name && <p>{name}{/\.docx$/i.test(name) ? " · 仅正文与表格文字，不含图片和排版" : /\.xlsx$/i.test(name) ? " · 仅单元格文本，不含公式计算、图片或样式" : ""}</p>}
    {error && <p role="alert">{error}</p>}
  </>;
}
