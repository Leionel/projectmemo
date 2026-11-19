import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { BOOKMARK_SPIRIT_ASSETS, BOOKMARK_SPIRIT_POSES, spiritAsset } from "@/lib/mascot/bookmarkSpirit";

const root = path.resolve("public/mascot/bookmark-spirit/v1");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as {
  states: Record<string, { web: string; master: string; width: number; height: number; hasAlpha: boolean; label: string; usage: string }>;
};

describe("书签精灵素材", () => {
  test("组件白名单与 manifest 一一对应，路径只在产品目录内", () => {
    expect(Object.keys(manifest.states).sort()).toEqual([...BOOKMARK_SPIRIT_POSES, "avatar"].sort());
    for (const [name, asset] of Object.entries(BOOKMARK_SPIRIT_ASSETS)) {
      expect(manifest.states[name]).toMatchObject({ web: "web/" + name + ".png", master: "master/" + name + ".png", width: asset.width, height: asset.height, hasAlpha: true });
      expect(asset.web.startsWith("/mascot/bookmark-spirit/v1/web/")).toBe(true);
      expect(asset.web).not.toMatch(/^https?:/);
      expect(fs.existsSync(path.join(root, asset.web.replace("/mascot/bookmark-spirit/v1/", "")))).toBe(true);
    }
    expect(spiritAsset("../../etc/passwd").web).toBe(BOOKMARK_SPIRIT_ASSETS.idle.web);
  });

  test("网页素材是真实透明背景，四角透明且中心有内容", async () => {
    for (const [name, asset] of Object.entries(BOOKMARK_SPIRIT_ASSETS)) {
      const file = path.join(root, asset.web.replace("/mascot/bookmark-spirit/v1/", ""));
      const meta = await sharp(file).metadata();
      expect(meta.hasAlpha, name).toBe(true);
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
      for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) expect(alpha(x, y), name).toBe(0);
      expect(alpha(Math.floor(info.width / 2), Math.floor(info.height / 2)), name).toBeGreaterThan(0);
      expect(fs.statSync(file).size, name + " 网页尺寸应保持轻量").toBeLessThan(120_000);
    }
  });

  test("六个姿态使用同一画幅与基线，切换不改变占位", async () => {
    for (const pose of BOOKMARK_SPIRIT_POSES) {
      const file = path.join(root, "web", pose + ".png");
      const meta = await sharp(file).metadata();
      expect([meta.width, meta.height], pose).toEqual([512, 512]);
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let top = info.height, bottom = -1, left = info.width, right = -1;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3] <= 8) continue;
        if (y < top) top = y; if (y > bottom) bottom = y;
        if (x < left) left = x; if (x > right) right = x;
      }
      expect(bottom, pose + " 底边应落在统一基线附近").toBeGreaterThan(455);
      expect(bottom, pose + " 底边应落在统一基线附近").toBeLessThan(485);
      expect(Math.abs((left + right) / 2 - info.width / 2), pose + " 应水平居中").toBeLessThan(24);
      expect(bottom - top, pose + " 应保留完整身体").toBeGreaterThan(300);
    }
  });
});
