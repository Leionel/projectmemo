/**
 * 书签精灵的唯一素材白名单。
 * 组件只接受这里的语义姿态，图片路径不从 props 或远端 URL 传入。
 * 与 public/mascot/bookmark-spirit/v1/manifest.json 的一致性由 tests/bookmarkSpirit.test.ts 锁定。
 */
export const BOOKMARK_SPIRIT_POSES = ["idle", "inspect", "thinking", "writing", "handoff", "success"] as const;
export type BookmarkSpiritPose = (typeof BOOKMARK_SPIRIT_POSES)[number];
export type BookmarkSpiritAssetName = BookmarkSpiritPose | "avatar";

type Asset = { web: string; master: string; width: number; height: number; label: string; usage: string };

const BASE = "/mascot/bookmark-spirit/v1";

export const BOOKMARK_SPIRIT_ASSETS: Record<BookmarkSpiritAssetName, Asset> = {
  idle: { web: BASE + "/web/idle.png", master: BASE + "/master/idle.png", width: 512, height: 512, label: "安静抱着项目夹", usage: "空闲、等待或静态陪伴" },
  inspect: { web: BASE + "/web/inspect.png", master: BASE + "/master/inspect.png", width: 512, height: 512, label: "看原记录、持放大镜", usage: "查看来源与导师核查" },
  thinking: { web: BASE + "/web/thinking.png", master: BASE + "/master/thinking.png", width: 512, height: 512, label: "轻托下巴、略显疑问", usage: "未知项、等待回答" },
  writing: { web: BASE + "/web/writing.png", master: BASE + "/master/writing.png", width: 512, height: 512, label: "坐在书堆上写稿", usage: "只在真实处理/写作状态使用" },
  handoff: { web: BASE + "/web/handoff.png", master: BASE + "/master/handoff.png", width: 512, height: 512, label: "递出项目夹", usage: "交回意见、成果交接" },
  success: { web: BASE + "/web/success.png", master: BASE + "/master/success.png", width: 512, height: 512, label: "夹好新页、轻微开心", usage: "有对应成功回执后短暂显示" },
  avatar: { web: BASE + "/web/avatar.png", master: BASE + "/master/avatar.png", width: 256, height: 256, label: "清晰的小头像", usage: "角色入口与提示，不替换品牌 Logo" },
};

/** 只允许白名单内的姿态；未知值回落到 idle，绝不拼接任意路径。 */
export function spiritAsset(pose: string): Asset {
  return (BOOKMARK_SPIRIT_ASSETS as Record<string, Asset>)[pose] ?? BOOKMARK_SPIRIT_ASSETS.idle;
}
