import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { InterventionPolicy } from "@/lib/generated/prisma/client";

export type PolicyDecision = "FIRE" | "SUPPRESS";

export const SUPPRESS_REASON_CODES = [
  "DUPLICATE",
  "SNOOZED",
  "QUIET_HOURS",
  "BUDGET_EXHAUSTED",
  "INSUFFICIENT_EVIDENCE",
  "NO_MATERIAL_CHANGE",
  "TOPIC_REDUCED",
] as const;

export interface PolicyCandidate {
  /** 真实候选使用 `${triggerType}:${dedupeKey}`；演示候选绕过预算管道 */
  candidateKey: string;
  triggerType: string;
  dedupeKey: string;
  severity: number;
  title: string;
  content: string;
  evidenceFacts: string[];
  evidenceCardIds: string[];
  evidenceRule: string;
  proposedActions: Array<Record<string, unknown>>;
  isSimulated: boolean;
}

export interface PolicyOutcome {
  candidateKey: string;
  decision: PolicyDecision;
  reasonCode: string;
  whyNow: string;
  interventionId: string | null;
}

interface LocalTimeParts {
  localDate: string;
  minuteOfDay: number;
}

function tzOffsetMinutes(timezone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const lookup = (type: string): number => {
    const value = parts.find((part) => part.type === type)?.value ?? "0";
    return Number.parseInt(value, 10);
  };
  const asUtc = Date.UTC(
    lookup("year"),
    lookup("month") - 1,
    lookup("day"),
    lookup("hour") % 24,
    lookup("minute"),
    lookup("second"),
  );
  return (asUtc - at.getTime()) / 60000;
}

function localTimeParts(timezone: string, now: Date): LocalTimeParts {
  const offset = tzOffsetMinutes(timezone, now);
  const local = new Date(now.getTime() + offset * 60000);
  const localDate = local.toISOString().substring(0, 10);
  const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  return { localDate, minuteOfDay };
}

function zonedMidnightUtc(localDate: string, timezone: string): Date {
  const naiveUtc = new Date(`${localDate}T00:00:00Z`);
  const offset = tzOffsetMinutes(timezone, naiveUtc);
  return new Date(naiveUtc.getTime() - offset * 60000);
}

function minuteToLabel(minute: number): string {
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function isQuietTime(policy: InterventionPolicy, parts: LocalTimeParts): boolean {
  const { quietStartMinute, quietEndMinute } = policy;
  if (quietStartMinute === quietEndMinute) return false;
  if (quietStartMinute > quietEndMinute) {
    // 跨午夜窗口（如 23:00–08:00）
    return parts.minuteOfDay >= quietStartMinute || parts.minuteOfDay < quietEndMinute;
  }
  return parts.minuteOfDay >= quietStartMinute && parts.minuteOfDay < quietEndMinute;
}

export async function getOrCreatePolicy(): Promise<InterventionPolicy> {
  const existing = await db.interventionPolicy.findUnique({ where: { scope: "GLOBAL" } });
  if (existing) return existing;
  try {
    return await db.interventionPolicy.create({ data: { scope: "GLOBAL" } });
  } catch (error) {
    // 并发初始化：读取已创建的默认策略
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      const policy = await db.interventionPolicy.findUnique({ where: { scope: "GLOBAL" } });
      if (policy) return policy;
    }
    throw error;
  }
}

export interface PolicyUpdateInput {
  dailyBudget?: number;
  quietStartMinute?: number;
  quietEndMinute?: number;
  timezone?: string;
}

export async function updatePolicy(input: PolicyUpdateInput): Promise<InterventionPolicy> {
  const policy = await getOrCreatePolicy();
  const data: Prisma.InterventionPolicyUpdateInput = {};
  if (input.dailyBudget !== undefined) {
    if (!Number.isInteger(input.dailyBudget) || input.dailyBudget < 0 || input.dailyBudget > 50) {
      throw new AppError("INVALID_POLICY", "每日预算必须是 0–50 的整数", 422);
    }
    data.dailyBudget = input.dailyBudget;
  }
  for (const field of ["quietStartMinute", "quietEndMinute"] as const) {
    const value = input[field];
    if (value !== undefined) {
      if (!Number.isInteger(value) || value < 0 || value > 1440) {
        throw new AppError("INVALID_POLICY", "静默时段必须是 0–1440 的分钟数", 422);
      }
      data[field] = value;
    }
  }
  if (input.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
    } catch {
      throw new AppError("INVALID_POLICY", "时区标识无效", 422);
    }
    data.timezone = input.timezone;
  }
  if (Object.keys(data).length === 0) return policy;
  return db.interventionPolicy.update({
    where: { id: policy.id },
    data: { ...data, version: { increment: 1 } },
  });
}

export async function restoreDefaultPolicy(): Promise<InterventionPolicy> {
  const policy = await getOrCreatePolicy();
  return db.interventionPolicy.update({
    where: { id: policy.id },
    data: {
      dailyBudget: 3,
      quietStartMinute: 1380,
      quietEndMinute: 480,
      timezone: "Asia/Shanghai",
      reducedTopics: Prisma.JsonNull,
      suggestionState: Prisma.JsonNull,
      version: { increment: 1 },
    },
  });
}

function reducedTopics(policy: InterventionPolicy): string[] {
  const raw = policy.reducedTopics;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (item && typeof item === "object" && !Array.isArray(item) && typeof (item as { triggerType?: unknown }).triggerType === "string"
      ? (item as { triggerType: string }).triggerType
      : null))
    .filter((item): item is string => item !== null);
}

async function countFiresInLocalDay(
  tx: Prisma.TransactionClient,
  projectId: string,
  localDate: string,
  timezone: string,
  topicPrefix?: string,
): Promise<number> {
  const start = zonedMidnightUtc(localDate, timezone);
  const end = new Date(start.getTime() + 86400000);
  return tx.interventionDecision.count({
    where: {
      decision: "FIRE",
      createdAt: { gte: start, lt: end },
      ...(topicPrefix ? { candidateKey: { startsWith: topicPrefix } } : {}),
      // 全局共享预算：不按项目过滤
    },
  });
}

/**
 * 规则候选 → 证据检查 → 去重/延期 → 静默期 → 每日预算 → 记录决策。
 * 决策、预算扣减与干预生成在同一事务提交；演示候选（sim:）绕过预算管道，不计入真实指标。
 */
export async function applyInterventionPolicy(
  projectId: string,
  candidates: PolicyCandidate[],
  now: Date = new Date(),
): Promise<PolicyOutcome[]> {
  const budgetEnabled = isFeatureEnabled("INTERVENTION_BUDGET_ENABLED", false);
  const policy = budgetEnabled ? await getOrCreatePolicy() : null;

  return db.$transaction(async (tx) => {
    const outcomes: PolicyOutcome[] = [];
    const parts = policy ? localTimeParts(policy.timezone, now) : null;
    const quiet = policy && parts ? isQuietTime(policy, parts) : false;
    const topicPrefixes = policy ? reducedTopics(policy).map((topic) => `${topic}:`) : [];

    for (const candidate of candidates) {
      if (candidate.isSimulated) {
        outcomes.push({
          candidateKey: candidate.candidateKey,
          decision: "FIRE",
          reasonCode: "FIRED",
          whyNow: "演示情境直接生成，不计入真实指标与预算。",
          interventionId: null,
        });
        continue;
      }

      if (!budgetEnabled || !policy || !parts) {
        outcomes.push({
          candidateKey: candidate.candidateKey,
          decision: "FIRE",
          reasonCode: "FIRED",
          whyNow: `规则 ${candidate.evidenceRule} 评估成立。`,
          interventionId: null,
        });
        continue;
      }

      // 1. 证据检查：没有事实依据的候选不触发
      if (candidate.evidenceFacts.length === 0) {
        outcomes.push({
          candidateKey: candidate.candidateKey,
          decision: "SUPPRESS",
          reasonCode: "INSUFFICIENT_EVIDENCE",
          whyNow: "该候选没有任何事实依据，已抑制。",
          interventionId: null,
        });
        continue;
      }

      // 2. 去重：已有未处理的同键提醒，刷新不重复产生
      const existing = await tx.agentIntervention.findUnique({
        where: { projectId_dedupeKey: { projectId, dedupeKey: candidate.dedupeKey } },
      });
      if (existing && existing.status === "OPEN" && existing.snoozedUntil === null) {
        outcomes.push({
          candidateKey: candidate.candidateKey,
          decision: "SUPPRESS",
          reasonCode: "DUPLICATE",
          whyNow: `相同提醒（${candidate.title}）已存在且未处理，不重复打扰。`,
          interventionId: existing.id,
        });
        continue;
      }
      if (existing && existing.status === "OPEN" && existing.snoozedUntil !== null && existing.snoozedUntil.getTime() > now.getTime()) {
        outcomes.push({
          candidateKey: candidate.candidateKey,
          decision: "SUPPRESS",
          reasonCode: "SNOOZED",
          whyNow: `该提醒已被延期至 ${existing.snoozedUntil.toISOString().substring(0, 16).replace("T", " ")}，到期后才会重新评估。`,
          interventionId: existing.id,
        });
        continue;
      }

      // 3. 静默期：跨午夜窗口按配置时区判断
      if (quiet) {
        outcomes.push({
          candidateKey: candidate.candidateKey,
          decision: "SUPPRESS",
          reasonCode: "QUIET_HOURS",
          whyNow: `当前处于静默时段（${minuteToLabel(policy.quietStartMinute)}–${minuteToLabel(policy.quietEndMinute)}，${policy.timezone}），已抑制；之后评估仍会保留该事项。`,
          interventionId: null,
        });
        continue;
      }

      // 4. 降频主题：每天至多 1 次
      const topicPrefix = topicPrefixes.find((prefix) => candidate.candidateKey.startsWith(prefix));
      if (topicPrefix) {
        const topicFires = await countFiresInLocalDay(tx, projectId, parts.localDate, policy.timezone, topicPrefix);
        if (topicFires >= 1) {
          outcomes.push({
            candidateKey: candidate.candidateKey,
            decision: "SUPPRESS",
            reasonCode: "TOPIC_REDUCED",
            whyNow: "该类提醒已被你要求降频：今天已经提醒过一次，剩余候选延后评估。",
            interventionId: null,
          });
          continue;
        }
      }

      // 5. 每日预算：跨项目共享（scope=GLOBAL），按配置时区自然日计数（UTC 存储）
      const firesToday = await countFiresInLocalDay(tx, projectId, parts.localDate, policy.timezone);
      if (firesToday >= policy.dailyBudget) {
        outcomes.push({
          candidateKey: candidate.candidateKey,
          decision: "SUPPRESS",
          reasonCode: "BUDGET_EXHAUSTED",
          whyNow: `今日全局提醒预算（${policy.dailyBudget} 次）已用完，该候选已记录，明天优先评估。`,
          interventionId: null,
        });
        continue;
      }

      // 6. FIRE：生成或恢复干预，并与决策同事务提交
      const remaining = policy.dailyBudget - firesToday - 1;
      const whyNow = `${candidate.evidenceFacts[0]}。当前处于允许提醒时段，今日全局预算剩余 ${Math.max(0, remaining)} 次。`;
      const intervention = await tx.agentIntervention.upsert({
        where: { projectId_dedupeKey: { projectId, dedupeKey: candidate.dedupeKey } },
        create: {
          projectId,
          dedupeKey: candidate.dedupeKey,
          triggerType: candidate.triggerType as never,
          severity: candidate.severity,
          title: candidate.title,
          content: candidate.content,
          evidence: {
            rule: candidate.evidenceRule,
            facts: candidate.evidenceFacts,
            cardIds: candidate.evidenceCardIds,
            evaluatedAt: now.toISOString(),
            whyNow,
          } as unknown as Prisma.InputJsonValue,
          proposedActions: candidate.proposedActions as unknown as Prisma.InputJsonValue,
        },
        update: {
          severity: candidate.severity,
          title: candidate.title,
          content: candidate.content,
          proposedActions: candidate.proposedActions as unknown as Prisma.InputJsonValue,
        },
      });

      await tx.interventionDecision.create({
        data: {
          projectId,
          candidateKey: candidate.candidateKey,
          decision: "FIRE",
          reasonCode: "FIRED",
          whyNow,
          evidenceRefs: {
            rule: candidate.evidenceRule,
            facts: candidate.evidenceFacts,
            cardIds: candidate.evidenceCardIds,
          } as unknown as Prisma.InputJsonValue,
          channel: "IN_APP",
          policyVersion: policy.version,
          interventionId: intervention.id,
          // 决策时间 = 评估时间（调用方时钟）；自然日计数窗口与它保持一致
          createdAt: now,
        },
      });
      outcomes.push({
        candidateKey: candidate.candidateKey,
        decision: "FIRE",
        reasonCode: "FIRED",
        whyNow,
        interventionId: intervention.id,
      });
    }

    // SUPPRESS 决策统一落库（演示候选除外）
    for (const outcome of outcomes) {
      if (outcome.decision === "SUPPRESS" && policy) {
        await tx.interventionDecision.create({
          data: {
            projectId,
            candidateKey: outcome.candidateKey,
            decision: "SUPPRESS",
            reasonCode: outcome.reasonCode,
            whyNow: outcome.whyNow,
            channel: "IN_APP",
            policyVersion: policy.version,
            interventionId: outcome.interventionId,
            createdAt: now,
          },
        });
      }
    }

    return outcomes;
  });
}

export async function listRecentDecisions(projectId: string, take = 30) {
  const decisions = await db.interventionDecision.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: Math.min(take, 100),
  });
  return decisions.map((decision) => ({
    id: decision.id,
    candidateKey: decision.candidateKey,
    decision: decision.decision,
    reasonCode: decision.reasonCode,
    whyNow: decision.whyNow,
    channel: decision.channel,
    policyVersion: decision.policyVersion,
    createdAt: decision.createdAt.toISOString(),
  }));
}
