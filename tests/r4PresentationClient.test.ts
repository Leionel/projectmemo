// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import fixtures from "./fixtures/r4/experience-v1.json";
import { hydratePresentation, type ExperienceAuthority } from "@/lib/conversation/experienceContract";
import { AgentMessageBlocks, supportsAgentPresentation } from "@/components/AgentMessageBlocks";
import { ConversationWorkCard } from "@/components/ConversationWorkCard";
import type { ConversationMessage, ConversationView } from "@/lib/types/conversation";
import type { ConversationWork } from "@/lib/types/conversationWork";
import { bindConversationDraftOwner, clearConversationDrafts, readConversationDraft, saveConversationDraft } from "@/lib/client/conversationDrafts";

vi.stubGlobal("React", React);
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.sessionStorage.clear(); });
function message(): ConversationMessage {
  return { schemaVersion: 1, id: "message", seq: 2, role: "ASSISTANT", content: "原回答", restricted: false, refs: [], sources: [], priorities: [], proposal: null,
    provider: "FIXTURE_NO_MODEL", limitations: [], observedProjectIds: ["project-research"] };
}
function view(): ConversationView {
  return { schemaVersion: 1, id: "conversation", title: "原讨论", scope: "WORKSPACE", version: 1, homeProjectId: null, focusProjectId: "project", messages: [],
    linkedProjects: [], activeTurn: null, hasMore: false, beforeSeq: null };
}
it("falls back to the original message for an unsupported presentation version", () => {
  const m = message();
  m.presentation = { schemaVersion: 2 } as unknown as NonNullable<ConversationMessage["presentation"]>;
  expect(supportsAgentPresentation(m)).toBe(false);
  const { container } = render(React.createElement(AgentMessageBlocks, { message: m, conversationId: "conversation", busy: false, onAction: vi.fn() }));
  expect(container.textContent).toBe("");
});
it.each(fixtures.cases)("renders distinct $domain semantic layouts and binds one explicit confirmation", async f => {
  const authority = structuredClone(f.observedAuthority) as unknown as ExperienceAuthority, m = message();
  m.presentation = hydratePresentation(f.observedPlan, authority);
  const onAction = vi.fn().mockResolvedValue(undefined), rendered = render(React.createElement(AgentMessageBlocks, { message: m, conversationId: authority.conversationId, busy: false, onAction }));
  expect([...rendered.container.querySelectorAll("[data-block]")].map(e => e.getAttribute("data-block"))).toEqual(f.expected.observedTypes);
  rendered.rerender(React.createElement(AgentMessageBlocks, { message: { ...m, presentation: hydratePresentation(f.approvalPlan, authority) }, conversationId: authority.conversationId, busy: false, onAction }));
  expect(onAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onAction.mock.calls[0][0]).toMatchObject({ actionKind: "CONFIRM", frozen: { proposalHash: authority.allowedActions[1].frozen!.proposalHash } });
});
it("renders markup as inert text and supports rich text without executable DOM", () => {
  const m = message();
  m.presentation = { schemaVersion: 1, allowedActions: [], blocks: [{ blockKey: "prose", emphasis: "primary", semanticType: "prose", fallbackText: "文本", refs: [], actionBindingIds: [],
    content: [{ type: "heading", level: 2, spans: [{ kind: "strong", text: "当前判断" }] }, { type: "paragraph", spans: [{ kind: "text", text: "<script>alert('x')</script>" }] }, { type: "table", headers: ["条件", "状态"], rows: [["目标设备", "未知"]] }] }] };
  const { container } = render(React.createElement(AgentMessageBlocks, { message: m, conversationId: "conversation", busy: false, onAction: vi.fn() }));
  expect(container.querySelector("script")).toBeNull(); expect(screen.getByRole("heading", { name: "当前判断" })).toBeTruthy();
  expect(screen.getByText("<script>alert('x')</script>")).toBeTruthy(); expect(screen.getByRole("table")).toBeTruthy();
});
it("keeps clarification drafts through readback, closing and reopening", () => {
  const f = fixtures.cases[0], a = f.observedAuthority as unknown as ExperienceAuthority;
  const q = a.catalog.find(b => b.semanticType === "question")!;
  const plan = { schemaVersion: 2, intent: "CLARIFY", primaryIntent: "NONE", composition: [{ blockKey: "question", semanticType: "question", emphasis: "primary", dataRefs: q.refs }] };
  const m = { ...message(), presentation: hydratePresentation(plan, a) }, onAction = vi.fn().mockResolvedValue(undefined);
  const first = render(React.createElement(AgentMessageBlocks, { message: m, conversationId: a.conversationId, busy: false, onAction }));
  // This fixture question has no ASK action; draft editing remains a harmless local action.
  const input = screen.getByRole("textbox"); fireEvent.change(input, { target: { value: "还没有独立日志" } });
  first.rerender(React.createElement(AgentMessageBlocks, { message: structuredClone(m), conversationId: a.conversationId, busy: false, onAction }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("还没有独立日志");
  first.unmount();
  render(React.createElement(AgentMessageBlocks, { message: m, conversationId: a.conversationId, busy: false, onAction }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("还没有独立日志");
});
it("keeps WorkCard draft across new messages and requires review after a business revision", async () => {
  const conversation = view(), ref = { kind: "ACTION" as const, id: "action", projectId: "project" };
  let token = "version-1";
  const work = (): ConversationWork => ({ ref, title: "原行动", status: "TODO", versionToken: token, version: 1, contextVersion: 0, planRevision: 0,
    question: null, approval: null, output: null, resultText: null, resultCardId: null, candidates: [], scenario: null });
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === "POST" ? { conversation } : work())));
  const onChange = vi.fn(), props = { conversation, workRef: ref, onChange, onClose: vi.fn() };
  const first = render(React.createElement(ConversationWorkCard, props));
  await screen.findByRole("textbox", { name: "实际完成结果" });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "我已经记录了原始结果，但尚未验收。" } });
  first.rerender(React.createElement(ConversationWorkCard, { ...props, conversation: { ...conversation, version: 2, messages: [message()] } }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method !== "POST").length).toBeGreaterThanOrEqual(2));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("原始结果");
  first.unmount();
  const second = render(React.createElement(ConversationWorkCard, props));
  await screen.findByRole("textbox"); expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("原始结果");
  token = "version-2";
  second.rerender(React.createElement(ConversationWorkCard, { ...props, conversation: { ...conversation, version: 3 } }));
  await screen.findByRole("button", { name: "已核对本次更新" });
  fireEvent.click(screen.getByRole("button", { name: /预览完成与复盘/ }));
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "已核对本次更新" }));
  fireEvent.click(screen.getByRole("button", { name: /预览完成与复盘/ }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(post[1]!.body as string)).toMatchObject({ versionToken: "version-2", answer: "我已经记录了原始结果，但尚未验收。" });
});
it("clears private drafts on owner changes and survives unavailable storage safely", () => {
  bindConversationDraftOwner("user-a");
  saveConversationDraft("conversation:composer", { ...readConversationDraft("conversation:composer"), answer: "私有草稿" });
  bindConversationDraftOwner("user-b");
  expect(readConversationDraft("conversation:composer").answer).toBe("");
  saveConversationDraft("conversation:composer", { ...readConversationDraft("conversation:composer"), answer: "新的草稿" });
  clearConversationDrafts(); expect(readConversationDraft("conversation:composer").answer).toBe("");
});
it("retains the selected comparison candidate when reopening the same answer", () => {
  const fixture = fixtures.cases[0], m = message();
  m.presentation = hydratePresentation(fixture.observedPlan, fixture.observedAuthority as unknown as ExperienceAuthority);
  const props = { message: m, conversationId: "conversation", busy: false, onAction: vi.fn() };
  const first = render(React.createElement(AgentMessageBlocks, props));
  fireEvent.click(screen.getByRole("button", { name: /核对已有减负方案的适用条件/ }));
  first.unmount(); render(React.createElement(AgentMessageBlocks, props));
  expect(screen.getByRole("button", { name: /核对已有减负方案的适用条件/ }).getAttribute("aria-pressed")).toBe("true");
});
