import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";

const chip = { id: "attachment", fileName: "合成图片.png", extractionStatus: "SUCCESS", extractionError: null };
const view = (id = "first") => ({ id, version: 1, title: id, focusProjectId: null, homeProjectId: null, activeTurn: null });
type Subject = {
  text: string; busy: boolean; attachBusy: boolean; generation: number; error: string;
  view: ReturnType<typeof view>; attachmentChips: typeof chip[];
  ask(): Promise<void>; removeAttachment(attachment: typeof chip): Promise<void>;
  selectDiscussion(id: string): Promise<void>; create(project?: boolean): Promise<void>; pickAttachment(): Promise<void>;
};

// Execute the page's real event handlers with native APIs replaced. ArkUI rendering is checked by the HAP build.
function harness() {
  const source = fs.readFileSync("harmonyos/entry/src/main/ets/pages/FocusConversation.ets", "utf8");
  const names = ["ask", "removeAttachment", "selectDiscussion", "create", "pickAttachment", "attachProjectId"];
  const methods = names.map(name => {
    const start = source.search(new RegExp(`  private (?:async )?${name}\\(`));
    if (start < 0) throw new Error(`Missing handler ${name}`);
    const next = source.slice(start + 1).search(/\n  (?:private |@Builder|build\()/);
    return source.slice(start, next < 0 ? source.length : start + 1 + next);
  }).join("\n");
  const service = {
    ask: vi.fn().mockResolvedValue({ status: "OBSERVING", conversation: view() }),
    read: vi.fn(async (id: string) => view(id)), create: vi.fn().mockResolvedValue({ id: "second" }),
    list: vi.fn().mockResolvedValue({ conversations: [] }),
  };
  const attachmentService = { upload: vi.fn().mockResolvedValue({ attachment: { ...chip, id: "new" } }), remove: vi.fn().mockRejectedValue(new Error("移除失败")) };
  const fail = vi.fn(), saveComposer = vi.fn(), copyPickedFile = vi.fn(() => "synthetic-copy");
  class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }
  const exports: { Subject?: new () => Subject } = {};
  const native = {
    exports, ApiError, ConversationTurnInput: class {}, ConversationCreateInput: class {},
    util: { generateRandomUUID: () => crypto.randomUUID() },
    promptAction: { showActionMenu: vi.fn().mockResolvedValue({ index: 0 }) },
    photoAccessHelper: { PhotoSelectOptions: class {}, PhotoViewMIMETypes: { IMAGE_TYPE: "image" }, PhotoViewPicker: class { async select() { return { photoUris: ["synthetic-uri"] }; } } },
    copyPickedFile, removePickedCopy: vi.fn(), getContext: () => ({ cacheDir: "synthetic-cache" }),
    setTimeout: vi.fn(), Edge: { Bottom: "bottom" },
  };
  const compiled = ts.transpileModule(`class Subject { ${methods} } exports.Subject = Subject;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, native);
  const subject = new exports.Subject!();
  Object.assign(subject, { view: view(), text: "检查实验进展", busy: false, attachBusy: false, analysisReady: true,
    generation: 1, error: "", pending: null, target: "", replyId: "", entity: undefined, originProjectId: "", sessions: [],
    attachmentChips: [chip], service, attachmentService, saveComposer, restoreComposer: vi.fn(), fail,
    messageScroller: { scrollEdge: vi.fn() }, });
  return { subject, service, attachmentService, fail, saveComposer, copyPickedFile, ApiError };
}

it("鸿蒙移除附件失败时保留条目并反馈错误", async () => {
  const h = harness();
  await h.subject.removeAttachment(chip);
  expect(h.subject.attachmentChips).toEqual([chip]);
  expect(h.fail).toHaveBeenCalledOnce();
  h.attachmentService.remove.mockResolvedValueOnce(true);
  await h.subject.removeAttachment(chip);
  expect(h.subject.attachmentChips).toEqual([]);
});

it("鸿蒙已被移除的附件可收起，讨论保持可用", async () => {
  const h = harness();
  h.attachmentService.remove.mockRejectedValueOnce(new h.ApiError("ATTACHMENT_NOT_FOUND", "已移除", 404));
  await h.subject.removeAttachment(chip);
  expect(h.subject.attachmentChips).toEqual([]);
  expect(h.fail).not.toHaveBeenCalled();
});

it("鸿蒙附件处理中不能提交或切换讨论", async () => {
  const h = harness();
  h.subject.attachBusy = true;
  await h.subject.ask();
  await h.subject.create();
  await h.subject.selectDiscussion("second");
  expect(h.service.ask).not.toHaveBeenCalled();
  expect(h.service.create).not.toHaveBeenCalled();
  expect(h.service.read).not.toHaveBeenCalled();
});

it.each(["create", "selectDiscussion"] as const)("鸿蒙 %s 后不残留上一讨论的附件", async method => {
  const h = harness();
  if (method === "create") await h.subject.create(false);
  else await h.subject.selectDiscussion("second");
  expect(h.subject.view.id).toBe("second");
  expect(h.subject.attachmentChips).toEqual([]);
});

it("鸿蒙达到单轮五份附件上限时不再上传讨论附件", async () => {
  const h = harness();
  h.subject.attachmentChips = Array.from({ length: 5 }, (_, id) => ({ ...chip, id: String(id) }));
  await h.subject.pickAttachment();
  expect(h.attachmentService.upload).not.toHaveBeenCalled();
  expect(h.subject.error).toContain("5");
});

it("鸿蒙后台接收问题后清空草稿，再次询问使用新请求", async () => {
  const h = harness();
  await h.subject.ask();
  expect(h.subject.text).toBe("");
  expect(h.subject.attachmentChips).toEqual([]);
  expect(h.saveComposer).toHaveBeenCalled();
  h.subject.text = "检查实验进展";
  await h.subject.ask();
  expect(h.service.ask.mock.calls[0][1].requestId).not.toBe(h.service.ask.mock.calls[1][1].requestId);
});

it("鸿蒙离开讨论后迟到的上传结果不写入新讨论", async () => {
  const h = harness();
  let finish!: (result: { attachment: typeof chip }) => void;
  h.attachmentService.upload.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const uploading = h.subject.pickAttachment();
  await vi.waitFor(() => expect(h.attachmentService.upload).toHaveBeenCalledOnce());
  h.subject.generation++;
  h.subject.view = view("second");
  h.subject.attachmentChips = [];
  h.subject.attachBusy = false;
  finish({ attachment: chip });
  await uploading;
  expect(h.subject.attachmentChips).toEqual([]);
  expect(h.subject.attachBusy).toBe(false);
});
