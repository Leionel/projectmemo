"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Cpu, Globe, KeyRound, LoaderCircle, Save, Settings, X } from "lucide-react";

type RuntimeSettings = {
  llmMode: "mock" | "openai-compatible";
  llmBaseUrl: string;
  llmApiKey: string;
};

type SettingsResponse = {
  llmMode?: RuntimeSettings["llmMode"];
  llmBaseUrl?: string;
  hasApiKey?: boolean;
  editable?: boolean;
  error?: { message?: string };
};

const initialSettings: RuntimeSettings = {
  llmMode: "mock",
  llmBaseUrl: "",
  llmApiKey: "",
};

export function GlobalSettings({ isMenuItem = false }: { isMenuItem?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editable, setEditable] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [settings, setSettings] = useState<RuntimeSettings>(initialSettings);

  async function openSettings() {
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const data = await response.json() as SettingsResponse;
      if (!response.ok) throw new Error(data.error?.message || "无法读取设置。");
      setSettings({
        llmMode: data.llmMode === "openai-compatible" ? "openai-compatible" : "mock",
        llmBaseUrl: data.llmBaseUrl || "",
        llmApiKey: "",
      });
      setHasApiKey(Boolean(data.hasApiKey));
      setEditable(Boolean(data.editable));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取设置。");
    } finally {
      setLoading(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json() as SettingsResponse;
      if (!response.ok) throw new Error(data.error?.message || "保存设置失败。");
      setOpen(false);
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存设置失败。");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "focus-ring w-full rounded-xl border border-[var(--rule)] bg-[var(--paper-strong)] px-4 py-2.5 text-sm font-medium text-[var(--ink)] outline-none transition-all focus:border-[var(--teal)] focus:shadow-[0_0_0_4px_var(--teal-pale)] dark:bg-[rgba(255,255,255,0.05)]";
  const buttonClass = isMenuItem
    ? "focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[var(--ink-soft)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--teal)]"
    : "focus-ring flex items-center gap-2 rounded-xl px-3 py-2 text-[var(--ink-soft)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--teal)] dark:hover:bg-[rgba(255,255,255,0.05)]";

  return (
    <>
      <button type="button" onClick={() => void openSettings()} className={buttonClass} aria-label="全局设置">
        <Settings size={17} /> 设置
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-[rgba(16,27,50,.46)] p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="global-settings-title" className="card-surface my-6 w-full max-w-2xl rounded-[2rem] bg-[var(--paper-strong)] p-1 shadow-2xl">
            <div className="rounded-[1.75rem] bg-[var(--card-bg)] p-5 sm:p-8">
              <div className="flex items-center justify-between pb-6">
                <div>
                  <h2 id="global-settings-title" className="text-2xl font-black text-[var(--ink)]">全局设置</h2>
                  <p className="mt-1.5 text-sm text-[var(--ink-soft)]">仅用于本地演示期间切换模型运行方式。</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} disabled={saving} aria-label="关闭" className="focus-ring grid h-9 w-9 place-items-center rounded-full bg-[var(--rule)] text-[var(--muted)] transition hover:bg-[var(--rule-strong)] hover:text-[var(--ink)]">
                  <X size={18} />
                </button>
              </div>

              {loading ? (
                <div className="py-16 text-center text-[var(--muted)]"><LoaderCircle className="mx-auto animate-spin" size={28} /><p className="mt-3 text-sm font-medium">正在读取配置...</p></div>
              ) : !editable ? (
                <div className="rounded-2xl border border-[var(--rule)] bg-[var(--paper-strong)] p-5 text-sm leading-7 text-[var(--ink-soft)]">
                  线上或非本机环境仅展示当前模型状态。请通过部署环境变量配置模型，不会在浏览器中读取或保存 API Key。
                </div>
              ) : (
                <form onSubmit={save} className="space-y-6">
                  <fieldset disabled={saving} className="space-y-4 disabled:opacity-70">
                    <div className="flex flex-col gap-4 rounded-2xl border border-[var(--rule)] bg-[var(--paper-strong)] p-5 shadow-sm transition hover:border-[var(--teal-pale)] sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-4">
                        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--teal-pale)] text-[var(--teal)] dark:bg-[rgba(0,210,143,0.15)]"><Cpu size={24} /></div>
                        <div>
                          <label htmlFor="llmMode" className="block text-base font-bold text-[var(--ink)]">运行模式</label>
                          <p className="mt-0.5 text-xs text-[var(--ink-soft)]">Mock 模式完全离线；真实模型异常仍会自动回退 Mock。</p>
                        </div>
                      </div>
                      <select id="llmMode" value={settings.llmMode} onChange={(event) => setSettings({ ...settings, llmMode: event.target.value as RuntimeSettings["llmMode"] })} className="focus-ring w-full rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] px-4 py-2.5 text-sm font-bold text-[var(--teal-strong)] outline-none sm:w-auto">
                        <option value="mock">Mock 模式（离线演示）</option>
                        <option value="openai-compatible">真实模型（OpenAI-compatible）</option>
                      </select>
                    </div>

                    {settings.llmMode === "openai-compatible" && (
                      <>
                        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--rule)] bg-[var(--paper-strong)] p-5 shadow-sm transition hover:border-[var(--teal-pale)]">
                          <div className="flex items-center gap-3">
                            <Globe size={18} className="text-[var(--muted)]" />
                            <label htmlFor="llmBaseUrl" className="text-sm font-bold text-[var(--ink)]">API Base URL</label>
                          </div>
                          <input id="llmBaseUrl" type="url" required value={settings.llmBaseUrl} onChange={(event) => setSettings({ ...settings, llmBaseUrl: event.target.value })} placeholder="例如：https://api.openai.com/v1" className={inputClass} />
                        </div>

                        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--rule)] bg-[var(--paper-strong)] p-5 shadow-sm transition hover:border-[var(--teal-pale)]">
                          <div className="flex items-center gap-3">
                            <KeyRound size={18} className="text-[var(--muted)]" />
                            <label htmlFor="llmApiKey" className="text-sm font-bold text-[var(--ink)]">API Key</label>
                          </div>
                          <input id="llmApiKey" type="password" value={settings.llmApiKey} onChange={(event) => setSettings({ ...settings, llmApiKey: event.target.value })} placeholder={hasApiKey ? "已配置（留空可保持不变）" : "sk-..."} className={inputClass} />
                          <p className="text-xs leading-5 text-[var(--ink-soft)]">密钥不会回显、不会写入文件，只用于当前本地运行进程；长期配置请使用 <code>.env</code>。</p>
                        </div>
                      </>
                    )}
                  </fieldset>

                  {error && <p role="alert" className="flex items-center gap-2 rounded-xl bg-[var(--brick-pale)] px-4 py-3 text-sm font-bold text-[var(--brick)]"><X size={16} /> {error}</p>}

                  <div className="pt-2">
                    <button disabled={saving} className="focus-ring editorial-button flex w-full items-center justify-center py-3.5 text-base shadow-lg transition-transform hover:-translate-y-1">
                      {saving ? <LoaderCircle className="mr-2 animate-spin" size={20} /> : <Save className="mr-2" size={20} />}
                      {saving ? "正在应用配置..." : "保存并应用配置"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
