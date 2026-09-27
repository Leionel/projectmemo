import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Web 与鸿蒙的跨端契约回归。
 *
 * 这一组测试固定的是「Web 不复制业务规则、不伪造成功」：
 * 会议导入必须绑定提案版本、附件缺 OCR 时不能报成功、提醒不能假装写进了系统日历、
 * 已读基线必须来自服务端游标。删掉对应实现时它们必须转红。
 */
const COMPONENTS = path.resolve(import.meta.dirname, "..", "components");
const PAGES = path.resolve(import.meta.dirname, "..", "app", "projects", "[id]");

function readComponent(name: string): string {
  return readFileSync(path.join(COMPONENTS, `${name}.tsx`), "utf8");
}

function readProjectPage(): string {
  return readFileSync(path.join(PAGES, "page.tsx"), "utf8");
}

describe("会议导入：预览 → 逐项勾选 → 确认", () => {
  const source = readComponent("MeetingImportCard");

  it("确认时绑定提案 ID、文本哈希与提案版本", () => {
    expect(source).toContain("proposalId: preview.proposalId");
    expect(source).toContain("sourceTextHash: preview.sourceTextHash");
    expect(source).toContain("proposalVersion: preview.proposalVersion");
    expect(source).toContain("selectedChangeIds: selected");
  });

  it("默认不勾选任何变化项：写入必须由用户逐项确认", () => {
    expect(source).toContain("setSelected([])");
    // 未选中时确认按钮不可用，服务端也要求至少一项
    expect(source).toContain("selected.length === 0");
  });

  it("待澄清项不可勾选，因此不会被写入", () => {
    expect(source).toContain('const selectable = change.status === "PROPOSED"');
    expect(source).toContain("信息不完整");
    // 可勾选项只从 PROPOSED 里取
    expect(source).toContain('change.status === "PROPOSED"');
  });

  it("预览过期时回到原文重新识别，不就地重试写入", () => {
    expect(source).toContain("STATE_CHANGED_REPREVIEW");
    expect(source).toContain("PROPOSAL_VERSION_MISMATCH");
    expect(source).toContain("PROPOSAL_EXECUTION_CONFLICT");
    expect(source).toContain("backToDraft(");
  });

  it("重复确认按服务端返回的同一份结果展示，不宣称二次写入", () => {
    expect(source).toContain("alreadyConfirmed");
    expect(source).toContain("没有重复写入");
  });

  it("会议日期使用浏览器日期控件，不要求手写格式", () => {
    expect(source).toContain('type="date"');
    expect(source).not.toContain('type="text"');
  });

  it("会后对比读取服务端状态 Diff，而不是自己算一份", () => {
    expect(source).toContain("/state/diff?");
    expect(source).toContain("result.afterSnapshotId");
  });
});

describe("状态与变化：已读基线来自服务端", () => {
  const source = readComponent("ProjectStateCard");

  it("读取状态时带上 consumerKey，并从响应里取已读位置", () => {
    expect(source).toContain("/state?consumerKey=");
    expect(source).toContain("lastSeenSnapshotId");
  });

  it("不在浏览器本地另存一份已读基线", () => {
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
  });

  it("「已了解」提交展示的快照与 consumerKey", () => {
    expect(source).toContain("displayedSnapshotId: snapshot.id");
    expect(source).toContain("consumerKey: getDeviceKey()");
  });

  it("变化详情拉取失败时不冒充「没有变化」", () => {
    expect(source).toContain("不冒充「没有变化」");
    expect(source).toContain("变化详情暂时无法获取");
  });

  it("简报是只读的：不提供就地创建行动的入口", () => {
    expect(source).toContain("/state/brief?");
    expect(source).toContain("读简报不会创建行动");
  });
});

describe("附件收件箱：不伪造提取成功", () => {
  const source = readComponent("AttachmentInbox");
  const captureBox = readComponent("CaptureBox");

  it("如实区分成功、待 OCR 与失败，并保留真实原因", () => {
    expect(source).toContain("NEEDS_OCR");
    expect(source).toContain("未生成伪造记忆");
    expect(source).toContain("extractionError");
  });

  it("提供重试提取与人工校对，并展示修订链", () => {
    expect(source).toContain("/retry");
    expect(source).toContain("/correct");
    expect(source).toContain("/revisions");
    expect(source).toContain("MANUAL_CORRECTION");
  });

  it("人工校对带原版本校验，冲突时重载而不是覆盖别人的校对", () => {
    expect(source).toContain("expectedCurrentText");
    expect(source).toContain("ATTACHMENT_TEXT_CHANGED");
  });

  it("声明的可选文件类型与服务端实际校验一致（PDF 与图片）", () => {
    expect(source).toContain('accept=".pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp"');
    expect(source).not.toContain(".docx");
  });

  it("CaptureBox 不再保留「即将支持解析」的假上传按钮", () => {
    expect(captureBox).not.toContain("即将支持解析");
    expect(captureBox).toContain("AttachmentInbox");
  });
});

describe("待办可执行前提：结论来自服务端评估", () => {
  const source = readComponent("ActionFeasibilityPanel");
  const board = readComponent("ActionBoard");

  it("每次展开都重新评估，并提供重新评估入口", () => {
    expect(source).toContain("/actions/feasibility?actionId=");
    expect(source).toContain("重新评估");
  });

  it("编辑一律带上读到的依赖版本，冲突时刷新并保留用户输入", () => {
    expect(source).toContain("expectedVersion: assessment.dependencyVersion");
    expect(source).toContain("FEASIBILITY_VERSION_CONFLICT");
    expect(source).toContain("你填写的内容已保留");
  });

  it("估时缺失时保持「未估算」，系统不编造估时", () => {
    expect(source).toContain("还没有填写预计用时");
    expect(source).toContain("estimatedMinutes: null");
  });

  it("行动板上每条未完成待办都能打开可行性与提醒设置", () => {
    expect(board).toContain("ActionFeasibilityPanel");
    expect(board).toContain("ActionReminderPanel");
    expect(board).toContain("看看能否安排");
    expect(board).toContain("日历提醒");
  });
});

describe("成果证据透视：每次打开重新核对", () => {
  const source = readComponent("ArtifactAuditPanel");
  const generator = readComponent("ArtifactGenerator");

  it("读取审计接口且禁用缓存", () => {
    expect(source).toContain("/audit");
    expect(source).toContain('cache: "no-store"');
  });

  it("不可逐句回溯时如实说明，不假装已核验", () => {
    expect(source).toContain("untraceable");
    expect(source).toContain("claimsStatus");
    expect(source).toContain("LEGACY_NO_CLAIMS");
  });

  it("被取代的记录给出取代链，不把历史版本当作当前事实", () => {
    expect(source).toContain("supersededByTitle");
    expect(source).toContain("已被「");
  });

  it("成果页提供证据透视入口", () => {
    expect(generator).toContain("ArtifactAuditPanel");
    expect(generator).toContain("证据透视");
  });
});

describe("提醒与设备边界：Web 不假装能写系统日历", () => {
  const reentry = readComponent("ReentryBrief");
  const reminder = readComponent("ActionReminderPanel");
  const panel = readComponent("InterventionPanel");

  it("再入场摘要展示应用内安排与设备同步状态，并指明需在鸿蒙端完成", () => {
    expect(reentry).toContain("/reentry");
    expect(reentry).toContain("应用内安排");
    expect(reentry).toContain("鸿蒙客户端");
    expect(reentry).not.toContain("calendarManager");
  });

  it("分区读取失败时如实标注，不伪造空项目", () => {
    expect(reentry).toContain("meta.status");
    expect(reentry).toContain("部分数据读取失败");
  });

  it("提醒面板仍然声明浏览器不能写系统日历", () => {
    expect(reminder).toContain("浏览器不能读写系统日历");
  });

  it("提醒展示后上报曝光回执，口径与鸿蒙端一致", () => {
    expect(panel).toContain("/interventions/exposures");
    expect(panel).toContain("installationId: getDeviceKey()");
    expect(panel).toContain("!item.isSimulated");
  });
});

describe("项目页信息架构：核心路径有目录入口", () => {
  const source = readProjectPage();

  it("新增能力都挂在项目大纲与核心闭环路径上", () => {
    for (const anchor of ["#reentry-brief", "#meeting-import", "#project-state", "#episode-checkpoint", "#project-health", "#interventions", "#action-board", "#schedule-planner", "#knowledge-assets", "#memory-copilot"]) {
      expect(source, `项目页应提供 ${anchor} 入口`).toContain(anchor);
    }
  });

  it("能力开关关闭时不渲染对应入口", () => {
    expect(source).toContain('reentryEnabled && <WorkspaceNavLink href="#reentry-brief"');
    expect(source).toContain('stateEnabled && <WorkspaceNavLink href="#project-state"');
    expect(source).toContain('schedulingEnabled && <WorkspaceNavLink href="#schedule-planner"');
  });

  it("工作台首屏给出 ProjectMemo Insight 与 60 秒再入场", () => {
    expect(source).toContain("<ProjectInsightCard intervention={topIntervention} />");
    expect(source).toContain("<ReentryBrief");
    expect(source).toContain("isInterventionActive");
  });

  it("会议导入与状态卡按开关接入，附件入口受收件箱开关控制", () => {
    expect(source).toContain('<MeetingImportCard projectId={id} stateEnabled={stateEnabled} />');
    expect(source).toContain('<ProjectStateCard projectId={id} enabled={stateEnabled} />');
    expect(source).toContain('<CaptureBox projectId={id} inboxEnabled={inboxEnabled} />');
    expect(source).toContain('<ArchivedMemoryList projectId={id} />');
  });
});

describe("记忆生命周期：归档不改变事实有效性", () => {
  const editor = readComponent("CardEditor");
  const archived = readComponent("ArchivedMemoryList");

  it("确认来源被明确标注为来源声明，而不是事实证明", () => {
    expect(editor).toContain('action === "CONFIRM"');
    expect(editor).toContain("来源声明，非事实证明");
  });

  it("归档前给出二次确认，并说明它只是展示偏好", () => {
    expect(editor).toContain("confirmArchive");
    expect(editor).toContain("归档后离开列表");
  });

  it("已归档列表可恢复，并保留时态状态说明", () => {
    expect(archived).toContain("/cards/archived");
    expect(archived).toContain('action: "RESTORE"');
    expect(archived).toContain("不会复活已被取代的旧事实");
  });
});
