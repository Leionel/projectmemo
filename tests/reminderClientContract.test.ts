import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { resolveReminderPanel } from "@/lib/client/reminderPanelState";

/**
 * 客户端契约回归。
 *
 * 这一组测试固定的是「只有一套提醒实现」与「界面不会给死按钮」：
 * 删除对应修复代码（旧的直接写日历流程、requiresRevokeBeforeChange 的拦截）时它们必须转红。
 */
const HARMONY_PAGES = path.resolve(import.meta.dirname, "..", "harmonyos", "entry", "src", "main", "ets", "pages");
const HARMONY_COMPONENTS = path.resolve(import.meta.dirname, "..", "harmonyos", "entry", "src", "main", "ets", "components");

function readPage(name: string): string {
  return readFileSync(path.join(HARMONY_PAGES, `${name}.ets`), "utf8");
}

describe("single reminder entry (旧流程清除)", () => {
  it("removed the second direct calendar-write flow from the project page", () => {
    const source = readPage("ProjectHome");
    // 旧流程会绕过 ActionReminder 回执，直接写设备日历并把 dueAt 当提醒时间
    for (const forbidden of [
      "CalendarSyncService",
      "writeBlocks(",
      "updateDueAt(",
      "removeMatchingReminder(",
      "rollbackWrites(",
      "showActionReminder",
      "saveActionReminder",
    ]) {
      expect(source.includes(forbidden), `ProjectHome.ets 不应再出现 ${forbidden}`).toBe(false);
    }
  });

  it("uses the shared ActionReminderBlock on both harmony pages", () => {
    for (const page of ["ProjectHome", "ActionBoard"]) {
      const source = readPage(page);
      expect(source.includes("ActionReminderBlock"), `${page}.ets 应复用 ActionReminderBlock`).toBe(true);
      // 功能开关探测：开关关闭时不渲染可写系统日历的入口
      expect(source.includes("reminderAvailable"), `${page}.ets 应有开关探测结果`).toBe(true);
    }
  });

  it("keeps the remaining calendar write in ActionBoard scoped to the batch schedule flow", () => {
    const source = readPage("ActionBoard");
    const writeLines = source.split("\n").filter((line) => line.includes("writeBlocks("));
    expect(writeLines.length).toBeGreaterThan(0);
    // 批量排程写入的实参是排程时段集合 pending；单待办提醒不得走这条路径
    for (const line of writeLines) {
      expect(line.includes("pending"), `writeBlocks 只应服务于批量排程：${line.trim()}`).toBe(true);
    }
  });

  it("gates the checkpoint suggestion reminder entry behind the feature probe", () => {
    const source = readPage("ProjectHome");
    // 建议区此前硬编码 reminderEnabled: true，会绕过功能开关
    expect(source.includes("reminderEnabled: true")).toBe(false);
    expect(source.includes("reminderEnabled: this.reminderAvailable")).toBe(true);
  });

  it("does not show a harmony time editor while an old device event is still awaiting cleanup", () => {
    const source = readFileSync(path.join(HARMONY_COMPONENTS, "ActionReminderBlock.ets"), "utf8");
    expect(source).toContain("this.state.canArrange && !this.state.requiresRevokeBeforeChange");
    expect(source).not.toContain("this.state.requiresRevokeBeforeChange ? '改到别的时间'");
    expect(source).toContain("请先撤销并确认设备日程已清理，再修改时间");
  });
});

describe("web reminder panel states (界面不给死按钮)", () => {
  const base = {
    status: "PLANNED",
    canArrange: true,
    requiresRevokeBeforeChange: false,
    blockedReason: null,
    revision: 1,
    hasReminderRecord: true,
    calendarEventId: null,
    calendarId: null,
  };

  it("never allows submitting a new time while the device event still exists", () => {
    const decision = resolveReminderPanel({
      ...base,
      status: "SYNCED",
      requiresRevokeBeforeChange: true,
      calendarEventId: "evt-1",
      calendarId: "cal-1",
    });
    expect(decision.canSubmitTime).toBe(false);
    expect(decision.reason).toContain("先撤销原提醒");
    expect(decision.requiresHarmonyDevice).toBe(true);
    expect(decision.nextStep).toBe("先撤销原提醒");
  });

  it("distinguishes plan time, device event and server revocation", () => {
    const synced = resolveReminderPanel({ ...base, status: "SYNCED", calendarEventId: "evt-1" });
    expect(synced.deviceStateLabel).toContain("设备日历里已有");
    expect(synced.planStateLabel).toContain("计划时间已保存");
    expect(synced.canSubmitTime).toBe(false);

    const revoked = resolveReminderPanel({ ...base, status: "REVOKED", calendarEventId: "evt-1" });
    expect(revoked.deviceStateLabel).toContain("服务端已撤销");
    expect(revoked.deviceStateLabel).toContain("待清理");
    // 服务端已撤销不等于设备已删除；清理回执落库前仍禁止修改时间。
    expect(revoked.canSubmitTime).toBe(false);
    expect(revoked.requiresHarmonyDevice).toBe(true);
    expect(revoked.nextStep).toBe("先撤销原提醒");
  });

  it("requires expectedRevision only when a reminder record already exists", () => {
    expect(resolveReminderPanel({ ...base, hasReminderRecord: false, status: "NOT_SCHEDULED" }).requiresExpectedRevision).toBe(false);
    expect(resolveReminderPanel({ ...base }).requiresExpectedRevision).toBe(true);
  });

  it("keeps the blocked reason instead of offering a form", () => {
    const decision = resolveReminderPanel({
      ...base,
      canArrange: false,
      blockedReason: "存在未满足的硬依赖，不能立即开始执行。",
      status: "PLANNED",
    });
    expect(decision.canSubmitTime).toBe(false);
    expect(decision.reason).toBe("存在未满足的硬依赖，不能立即开始执行。");
    expect(decision.nextStep).toBe("先处理阻塞");
  });
});
