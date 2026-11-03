"use client";
/**
 * 顶部四问工作包（C1 接线骨架）。
 *
 * 只消费服务端 `readback.workPacket`（final-a-workpacket-v1，见 lib/types/workPacket.ts）：
 * 已经做了什么、依据是什么、为何停下、现在由谁做哪一步。
 * 客户端不重算生命周期、优先级或授权；primaryAction 只做页面内导航/重读，不是执行令牌。
 *
 * 旧后端/包缺失时保留原详情并说明“当前摘要暂未提供”，不构造默认成功事实。
 */
import type { MissionReadback as ReadbackData } from "@/lib/mission/readback";
import type { WorkPacket } from "@/lib/types/workPacket";

export type MissionWorkPacketProps = {
  /** null = 读回尚未成功或已清空；undefined = 旧后端未提供整个工作包。 */
  readback: ReadbackData | null;
  packet: WorkPacket | undefined;
  missionId: string;
  /** 只重新读取同一只读端点；不得提交业务命令。 */
  onReload: () => void;
  disabled?: boolean;
};

export function MissionWorkPacket({ packet }: MissionWorkPacketProps) {
  // C1 实现四问、主操作、阻断、观察时间、权威边界与覆盖展开；骨架阶段保持空渲染。
  if (!packet) return null;
  return null;
}
