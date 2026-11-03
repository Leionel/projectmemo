# 用户追加要求：决赛演示改为「本页可播放」（实现与核验记录）

## 1. 决定与依据

- 2026-11-03（UTC+8）用户在会话中直接要求：「b站那里可不可以直接把视频放在那里可以播放？不必要跳转b站」。
- 该要求**优先于**规划文档 16 号任务书 B 段与上一轮回执里“只做外链、不 iframe/自动嵌入”的旧约束；实现按“点击后内嵌官方播放器”执行，并保留外链退路。
- 仍保留的安全/隐私边界：**页面加载阶段不请求任何外部域名**；只有用户点击“在本页加载播放器”后才创建 Bilibili `player.bilibili.com` iframe，并可见地说明“加载前不请求外部站点”。不自动播放页面加载时的视频；不预连接、不预取封面。

## 2. 实现

- 新增 `components/home/DemoVideoPlayer.tsx`（client）：
  - 默认渲染本地“门面”：深墨 16:9 画面、播放圆钮、标题「2026 C4-AI 决赛演示视频」、「点击加载播放器 · 在播放器内播放」、左上角「公开视频 · Bilibili」；门面本身不发起外部请求。
  - 点击后用官方 `https://player.bilibili.com/player.html?bvid=BV1Qaxb6PE7G&page=1&high_quality=1&danmaku=0&autoplay=1` 替换为 iframe（`allow="autoplay; fullscreen; picture-in-picture; encrypted-media"`、`allowFullScreen`、`loading="lazy"`、`referrerPolicy="no-referrer-when-downgrade"`、有 `title`）。
  - 焦点：按钮卸载后把焦点送进 iframe（延时 180/900/1800ms 三次兜底），实测 `document.activeElement` 为 `IFRAME` 且名称为「2026 C4-AI 决赛演示视频（Bilibili 官方播放器）」。
  - 收起：active 时显示「收起播放器」按钮，点击卸载 iframe、恢复门面并把焦点送回门面按钮；可随时停止外部请求。
  - 退路：保留「在 Bilibili 打开（新窗口）」外链，`target=_blank`、`rel="noopener noreferrer"`，aria-label 含“新窗口”。
- `app/page.tsx` 05 区改用该组件；文案改为“默认只显示本地画面；点击后在本页加载 Bilibili 官方播放器，也可以在新窗口打开。”
- `app/home.module.css` 新增播放器门面/iframe/下方说明/收起按钮样式（桌面 16:9 ≈574×323 @1440；390 下 354×199，无水平溢出）。

## 3. 实测（本机 Edge 通道，headless 与 headed 均记录）

| 断言 | 结果 |
|---|---|
| 加载阶段外部请求 | **0**（26 请求全部同源；无 iframe、无 Bilibili 请求、无预连接） |
| 点击前 iframe 数量 | 0 |
| 点击后 iframe | 1，src 为 `player.bilibili.com/player.html?bvid=BV1Qaxb6PE7G...`，title 正确 |
| 点击后外部请求 | 仅用户主动触发后出现：`player.bilibili.com`、`s1.hdslb.com`、`data.bilibili.com`（headed Edge 另见 `api.bilibili.com`、`*.bilivideo.com` 视频流）；无 console/page error |
| 点击后焦点 | `IFRAME`（名称含“Bilibili 官方播放器”） |
| 收起播放器 | iframe=0、门面恢复、焦点回到门面按钮；外部请求停止 |
| 播放器加载 | 播放器文档 200，`document.title` = `External Player - 哔哩哔哩嵌入式外链播放器`，iframe 内存在 `video` 元素、`duration=277`（4:37，与平台元数据一致） |
| 自动播放 | 自动化环境下 `video.paused=true`、readyState=0 —— 浏览器对跨域未静音自动播放有限制；页面文案已写“在播放器内播放”，由用户在官方播放器内点一次播放。**不宣称“自动播放成功”** |
| 外链 | 词条名含“新窗口”，`target=_blank`、`rel=noopener noreferrer` |
| 布局 | 1440 / 390 无水平溢出 |

## 4. 对既有证据的影响

- 该改动是新候选源码的一部分：此前绑定 `4b69614` 的 after 六图/网络/性能/无障碍结果需要在新 SHA 上重取或经明确静态 delta 复核后继承；“加载期 0 外域”仍成立，但“点击后”新增的用户主动外部请求必须单独记为“用户主动加载官方播放器”，不再计入“页面加载 0 外域”。
- 独立的 claims/a11y/证据轨需按新 SHA 复核：点击前 0 外域、点击后外部请求属于预期、焦点/收起/外链名称/文案事实。

## 5. 回退

- 单独 revert 本提交即可恢复纯外链版本；不涉及数据、契约或部署。
