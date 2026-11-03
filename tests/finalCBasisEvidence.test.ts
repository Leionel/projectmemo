// @vitest-environment jsdom
/**
 * C2 依据/原文/纠正入口回归。
 *
 * 使用纯 fixture（非数据库、非模型、不发网络），覆盖合同要求的状态组合：
 * ALLOWED / SUPPRESSED / UNKNOWN / 旧服务缺 currentUse / CHANGED 与 ALLOWED 正交 /
 * availability=UNAVAILABLE 但 revisionAvailability 缺失 / NOT_APPLIED / 覆盖截断 /
 * 精确摘录与用户核对非独立证实 / 纠正入口只在可定位 OUTPUT_REFERENCE 时出现。
 */
import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { MissionReadback } from "@/lib/mission/readback";
import type {
  WorkPacket,
  WorkPacketBasis,
  WorkPacketCoverage,
  WorkPacketMaterialUseItem,
} from "@/lib/types/workPacket";
import { MissionBasisEvidence } from "@/components/MissionBasisEvidence";

const correction = vi.hoisted(() => ({
  props: [] as Array<{ projectId: string; kind: string; sourceId: string; onChanged: () => void }>,
}));

// 只验证接线：真实 ClaimCorrection 的输入选择/草稿/幂等由 ux2CorrectionControls 覆盖。
vi.mock("@/components/ClaimCorrection", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    ClaimCorrection: (props: { projectId: string; kind: string; sourceId: string; onChanged: () => void }) => {
      correction.props.push(props);
      return React.createElement("button", { type: "button", onClick: props.onChanged }, "纠正理解");
    },
  };
});

const NOW = "2026-11-03T04:00:00.000Z";
const HASH = "a".repeat(64);

function item(overrides: Partial<WorkPacketMaterialUseItem> = {}): WorkPacketMaterialUseItem {
  return {
    sourcePointer: { id: "capture:c-1", hash: HASH },
    title: "10月推理显存记录",
    availability: "CURRENT",
    revisionAvailability: "CURRENT",
    availabilityMeaning: "REVISION_MATCH_AND_CURRENT_USE_POLICY",
    currentUse: {
      state: "ALLOWED",
      independentEvidence: false,
      reason: "ORIGINAL_OBSERVATION",
      policy: "SOURCE_POLICY_V1",
      checkedAt: NOW,
      appliesTo: "CURRENT_USE_ONLY",
    },
    facts: [{ kind: "SAVED", refId: "capture:c-1" }],
    coverage: { loadedCharacters: 30, totalCharacters: 30, truncated: false, extractionStatus: "SUCCESS" },
    bodyCoverage: "NOT_RECORDED",
    excerpt: "10月推理显存 6.2GB，来自本地实验记录。",
    ...overrides,
  };
}

function uses(items: WorkPacketMaterialUseItem[]): NonNullable<WorkPacketBasis["materialUses"]> {
  return {
    schemaVersion: 1,
    questionId: "q-1",
    items,
    coverage: {
      eventLimit: 80, eventsTruncated: false, stepLimit: 40, stepsTruncated: false,
      outputLimit: 20, outputsTruncated: false, receiptsTruncated: false,
      projectRunLimit: 40, runsTruncated: false, sourceLimit: 8, sourceLimitReached: false,
      mapping: "DIRECT_SOURCE_POINTERS_ONLY",
    },
  } as unknown as NonNullable<WorkPacketBasis["materialUses"]>;
}

function packet(basisOverrides: Partial<WorkPacketBasis> = {}, coverage?: Partial<WorkPacketCoverage>): WorkPacket {
  return {
    schemaVersion: 1,
    contractVersion: "final-a-workpacket-v1",
    readAt: NOW,
    identity: {} as never,
    snapshot: {} as never,
    authority: {} as never,
    observations: {} as never,
    done: {} as never,
    basis: {
      questionId: "q-1",
      materialUses: uses([item()]),
      evidenceReviews: { items: [], truncated: false },
      currentUsePolicy: "SOURCE_POLICY_APPLIED",
      note: "依据只取原资料使用与证据审查投影；历史留痕保留原身份，当前可用不等于独立支持。",
      ...basisOverrides,
    },
    stopped: {} as never,
    next: {} as never,
    blockers: [],
    coverage: { windows: [], policy: "NOT_FOUND_IS_NOT_NEVER", ...coverage },
    realityOutcome: "NOT_INFERRED",
  } as unknown as WorkPacket;
}

function readback(overrides: Record<string, unknown> = {}): MissionReadback {
  return {
    missionId: "m-1",
    projectId: "p-1",
    missionVersion: 3,
    missionStatus: "WAITING_INPUT",
    observedAt: NOW,
    readAt: NOW,
    missionUpdatedAt: NOW,
    materialUses: uses([item()]),
    evidenceReviews: { items: [], truncated: false },
    selected: { question: { id: "q-1", text: "10月推理显存是多少", historical: false }, approval: null, output: null, receipt: null },
    ...overrides,
  } as unknown as MissionReadback;
}

function renderBasis(options: {
  packet?: WorkPacket;
  readback?: MissionReadback;
  onReload?: () => void;
  disabled?: boolean;
} = {}) {
  return render(createElement(MissionBasisEvidence, {
    packet: options.packet ?? packet(),
    readback: options.readback ?? readback(),
    missionId: "m-1",
    onReload: options.onReload ?? (() => {}),
    disabled: options.disabled,
  }));
}

afterEach(() => {
  cleanup();
  correction.props.length = 0;
  vi.unstubAllGlobals();
});

describe("C2 当前判断的依据", () => {
  it("ALLOWED/CURRENT：当前允许与修订匹配独立成行，历史留痕与摘录保留", () => {
    renderBasis();
    expect(screen.getByRole("heading", { level: 5, name: "逐项依据与原文" })).toBeTruthy();
    expect(screen.getByText("当前允许作为依据（仅当前使用，不代表独立证据）")).toBeTruthy();
    expect(screen.getByText("原修订匹配")).toBeTruthy();
    expect(screen.getByText("历史留痕")).toBeTruthy();
    expect(screen.getByText("已保存，当前范围未找到使用位置")).toBeTruthy();
    expect(screen.getByText("查看原记录摘录")).toBeTruthy();
    expect(screen.getByText("10月推理显存 6.2GB，来自本地实验记录。")).toBeTruthy();
    expect(screen.queryByText(/当前不作为依据或推荐/)).toBeNull();
  });

  it("SUPPRESSED：历史 facts 仍在，但不作为当前推荐或默认引用", () => {
    const suppressed = item({
      currentUse: {
        state: "SUPPRESSED", independentEvidence: false, reason: "ROOT_SUPPRESSED",
        policy: "SOURCE_POLICY_V1", checkedAt: NOW, appliesTo: "CURRENT_USE_ONLY",
      },
      facts: [{ kind: "SAVED", refId: "capture:c-1" }, { kind: "BOUND", refId: "step-1" }],
      excerpt: "历史摘录仍保留，但当前不再作为依据。",
    });
    renderBasis({ packet: packet({ materialUses: uses([suppressed]) }) });
    expect(screen.getByText("当前许可已被撤回，不作为当前推荐或默认引用")).toBeTruthy();
    // 修订事实与当前许可正交：许可被撤回不代表修订变化。
    expect(screen.getByText("原修订匹配")).toBeTruthy();
    expect(screen.getByText("已绑定原委托，尚未找到后续引用")).toBeTruthy();
    expect(screen.getByText("历史摘录仍保留，但当前不再作为依据。")).toBeTruthy();
    expect(screen.getByText(/当前不作为依据或推荐/)).toBeTruthy();
    expect(screen.queryByText(/当前允许作为依据/)).toBeNull();
  });

  it("UNKNOWN：来源链未知，不用于当前推荐", () => {
    renderBasis({
      packet: packet({
        materialUses: uses([item({
          currentUse: {
            state: "UNKNOWN", independentEvidence: false, reason: "LINEAGE_UNKNOWN",
            policy: "SOURCE_POLICY_V1", checkedAt: NOW, appliesTo: "CURRENT_USE_ONLY",
          },
        })]),
      }),
    });
    expect(screen.getByText("当前来源链未知，不用于当前推荐")).toBeTruthy();
    expect(screen.queryByText(/当前允许作为依据/)).toBeNull();
  });

  it("currentUse 缺失或为 null 时只显示资格未知，不推断允许", () => {
    for (const currentUse of [undefined, null]) {
      renderBasis({
        packet: packet({
          materialUses: uses([item({ currentUse: currentUse as never, revisionAvailability: undefined, availabilityMeaning: null })]),
        }),
      });
      expect(screen.getByText("旧服务未提供当前许可判断 · 资格未知")).toBeTruthy();
      expect(screen.getByText("修订状态未单独提供 · 未知")).toBeTruthy();
      expect(screen.queryByText(/当前允许作为依据/)).toBeNull();
      cleanup();
    }
  });

  it("CHANGED 与 ALLOWED 正交显示：修订已变化不掩盖当前许可", () => {
    renderBasis({
      packet: packet({
        materialUses: uses([item({
          availability: "CHANGED",
          revisionAvailability: "CHANGED",
          facts: [{ kind: "SAVED", refId: "capture:c-1" }, { kind: "BOUND", refId: "step-1" }],
        })]),
      }),
    });
    expect(screen.getByText("原修订已变化（历史留痕保留）")).toBeTruthy();
    expect(screen.getByText("当前允许作为依据（仅当前使用，不代表独立证据）")).toBeTruthy();
  });

  it("availability=UNAVAILABLE 但 revisionAvailability 缺失时，不声称版本变化", () => {
    renderBasis({
      packet: packet({
        materialUses: uses([item({
          availability: "UNAVAILABLE",
          revisionAvailability: undefined,
          currentUse: undefined,
        })]),
      }),
    });
    expect(screen.getByText(/修订状态未单独提供 · 未知/)).toBeTruthy();
    expect(screen.queryByText(/修订已变化/)).toBeNull();
    expect(screen.queryByText(/版本变化/)).toBeNull();
  });

  it("NOT_APPLIED 旧服务：显著说明未应用许可判断，所有资格只记未知", () => {
    renderBasis({
      packet: packet({
        currentUsePolicy: "NOT_APPLIED",
        materialUses: uses([item({ currentUse: undefined, revisionAvailability: undefined, availabilityMeaning: null })]),
      }),
    });
    expect(screen.getByText("本次未应用来源许可判断，当前资格未知。")).toBeTruthy();
    expect(screen.getByText("旧服务未提供当前许可判断 · 资格未知")).toBeTruthy();
    expect(screen.queryByText(/当前允许作为依据/)).toBeNull();
    expect(screen.queryByText(/当前允许.*独立/)).toBeNull();
  });

  it("basis.materialUses 为 null 时退回原 readback；两者都没有才说明未读取窗口", () => {
    const { unmount } = renderBasis({
      packet: packet({ materialUses: null }),
      readback: readback({ materialUses: uses([item()]) }),
    });
    expect(screen.getByText("当前允许作为依据（仅当前使用，不代表独立证据）")).toBeTruthy();
    unmount();
    cleanup();
    renderBasis({
      packet: packet({ materialUses: null }),
      readback: readback({ materialUses: null }),
    });
    expect(screen.getByText(/本次未读取资料使用窗口，未找到不等于从未使用/)).toBeTruthy();
  });

  it("资料使用窗口为空时说明未找到不等于从未使用", () => {
    renderBasis({ packet: packet({ materialUses: uses([]) }) });
    expect(screen.getByText("本次资料使用窗口内没有记录；未找到不等于从未使用。")).toBeTruthy();
  });

  it("只有文件级定位时不编造页码或段落；附件仅在当前可用时给原件入口", () => {
    renderBasis();
    expect(screen.getByText("仅定位到原文件/记录，未记录页码或段落，不编造精确位置。")).toBeTruthy();
    expect(screen.queryByText(/第\s*\d+\s*页/)).toBeNull();
    expect(screen.queryByText(/段落\s*\d+/)).toBeNull();
    cleanup();

    renderBasis({
      packet: packet({ materialUses: uses([item({ sourcePointer: { id: "attachment:att-1", hash: HASH } })]) }),
    });
    const attachment = screen.getByRole("link", { name: "查看附件原件" });
    expect(attachment.getAttribute("href")).toBe("/api/projects/p-1/attachments/att-1/file");
    expect(screen.queryByText(/仅定位到原文件\/记录/)).toBeNull();
    cleanup();

    renderBasis({
      packet: packet({
        materialUses: uses([item({
          sourcePointer: { id: "attachment:att-1", hash: HASH },
          currentUse: {
            state: "SUPPRESSED", independentEvidence: false, reason: "ROOT_SUPPRESSED",
            policy: "SOURCE_POLICY_V1", checkedAt: NOW, appliesTo: "CURRENT_USE_ONLY",
          },
        })]),
      }),
    });
    expect(screen.queryByRole("link", { name: "查看附件原件" })).toBeNull();
    expect(screen.getByText("仅定位到原文件/记录，未记录页码或段落，不编造精确位置。")).toBeTruthy();
  });

  it("OUTPUT_REFERENCE 链接回原草稿版本，带原 outputId/revision/questionId", () => {
    renderBasis({
      packet: packet({
        materialUses: uses([item({
          facts: [{ kind: "SAVED", refId: "capture:c-1" }, { kind: "OUTPUT_REFERENCE", refId: "output-9", revision: 3 }],
        })]),
      }),
    });
    const link = screen.getByRole("link", { name: "查看草稿版本 3" });
    const url = new URL(link.getAttribute("href") as string, "https://example.test");
    expect(url.pathname).toBe("/projects/p-1/missions");
    expect(url.searchParams.get("mission")).toBe("m-1");
    expect(url.searchParams.get("outputId")).toBe("output-9");
    expect(url.searchParams.get("revision")).toBe("3");
    expect(url.searchParams.get("questionId")).toBe("q-1");
  });

  it("精确摘录与用户核对都不等于独立证实，覆盖截断说明未找到不等于从未发生", () => {
    renderBasis({
      packet: packet({
        materialUses: uses([item({
          facts: [
            { kind: "SAVED", refId: "capture:c-1" },
            { kind: "EXACT_QUOTE", refId: "output-1", revision: 1 },
          ],
        })]),
        evidenceReviews: {
          items: [{
            eventId: "ev-1", observedAt: NOW, fitHash: "f".repeat(16), fitStatus: "FIT",
            ruleVersion: "fit-v1", truthVerified: false,
          }],
          truncated: true,
        },
      }, {
        windows: [{ name: "MATERIAL_USES", limit: 8, returned: 8, truncated: true, note: "" }],
      }),
    });
    expect(screen.getByText(/原文精确摘录只表示引用范围，不等于独立证实/)).toBeTruthy();
    expect(screen.getByText(/规则\/条件匹配或用户核对不等于独立证实/)).toBeTruthy();
    expect(screen.getAllByText(/truthVerified=false/).length).toBeGreaterThan(0);
    expect(screen.getByText(/条件对应/)).toBeTruthy();
    expect(screen.getByText(/证据审查窗口已截断；未找到记录不等于从未发生/)).toBeTruthy();
    expect(screen.getByText(/查询窗口已截断（资料使用）；未找到记录不等于从未发生/)).toBeTruthy();
  });

  it("纠正入口仅在可定位 OUTPUT_REFERENCE 时出现，onChanged 只触发重新读取", () => {
    const onReload = vi.fn();
    renderBasis({
      onReload,
      packet: packet({
        materialUses: uses([item({ facts: [{ kind: "SAVED", refId: "capture:c-1" }, { kind: "BOUND", refId: "step-1" }] })]),
      }),
      readback: readback({ selected: null }),
    });
    expect(screen.queryByRole("button", { name: "纠正理解" })).toBeNull();
    expect(screen.getByText(/未找到可定位的原草稿版本，暂不提供纠正入口/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "回原任务核对原记录" })).toBeTruthy();
    cleanup();

    renderBasis({
      onReload,
      packet: packet({
        materialUses: uses([item({
          facts: [{ kind: "SAVED", refId: "capture:c-1" }, { kind: "OUTPUT_REFERENCE", refId: "output-7", revision: 2 }],
        })]),
      }),
    });
    expect(correction.props).toHaveLength(1);
    expect(correction.props[0]).toMatchObject({ projectId: "p-1", kind: "MISSION_OUTPUT", sourceId: "output-7" });
    expect(screen.getByText(/纠正影响后续理解，原记录与原提案需重新核对/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "纠正理解" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/未找到可定位的原草稿版本/)).toBeNull();
  });

  it("直接消费 A 的纯合同样本：被抑制来源保留历史 facts，修订缺失不推断变化", () => {
    const sample = JSON.parse(readFileSync(
      path.join(process.cwd(), "evidence/final-a/20261103/samples/a1-pure/FS-A05-SOURCE-CURRENT-USE-SUPPRESSED.json"),
      "utf8",
    )) as { workPacket: WorkPacket };
    renderBasis({ packet: sample.workPacket, readback: readback({ materialUses: null }) });
    expect(screen.getByText("当前许可已被撤回，不作为当前推荐或默认引用")).toBeTruthy();
    expect(screen.getByText("草稿版本 1 中已引用")).toBeTruthy();
    expect(screen.getByText("原记录摘录：本地实验记录（历史留痕）。")).toBeTruthy();
    // 该样本只有旧 availability 字段：修订状态记未知，不推断“修订已变化”。
    expect(screen.getByText(/修订状态未单独提供 · 未知/)).toBeTruthy();
    expect(screen.queryByText(/修订已变化/)).toBeNull();
    const draft = screen.getByRole("link", { name: "查看草稿版本 1" });
    expect(draft.getAttribute("href")).toContain("outputId=output-1");
  });

  it("渲染不发起网络请求，也不自动抢占焦点", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderBasis();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("样式只使用主题变量，长文案可换行，不引入全局 CSS", () => {
    const css = readFileSync(path.join(process.cwd(), "components/MissionBasisEvidence.module.css"), "utf8");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("var(--rule)");
    expect(css).toContain("var(--paper)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain("rgb(");
    const source = readFileSync(path.join(process.cwd(), "components/MissionBasisEvidence.tsx"), "utf8");
    expect(source).toContain('import styles from "./MissionBasisEvidence.module.css"');
    expect(source).not.toMatch(/import\s+["']\.\/globals\.css/);
  });
});
