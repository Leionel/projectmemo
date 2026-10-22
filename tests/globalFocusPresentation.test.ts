import { expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { missionStatusLabels } from "@/lib/mission/presentation";
const native: { focusStatusLabel: (status: string) => string; focusActionLabel: (status: string, kind: string) => string } = {} as typeof native;
const source = fs.readFileSync("harmonyos/entry/src/main/ets/common/GlobalFocusPresentation.ets", "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext("(function(exports){" + code + "})", {})(native);
it.each(["WAITING_INPUT", "WAITING_APPROVAL", "PAUSED", "FAILED", "READY", "RUNNING"])("双端焦点的%s语义一致", status => {
  expect(native.focusStatusLabel(status)).toBe(missionStatusLabels[status]);
});
it("审批、补料、暂停与失败进入各自原流程，不能通用地显示完成", () => {
  expect(native.focusActionLabel("WAITING_INPUT", "mission")).toBe("补充委托资料 →");
  expect(native.focusActionLabel("WAITING_APPROVAL", "mission")).toBe("审阅待批准提案 →");
  expect(native.focusActionLabel("PAUSED", "mission")).toBe("查看暂停原因 →");
  expect(native.focusActionLabel("FAILED", "mission")).toBe("查看失败原因 →");
  expect(native.focusActionLabel("RUNNING", "mission")).toBe("查看委托进展 →");
});
