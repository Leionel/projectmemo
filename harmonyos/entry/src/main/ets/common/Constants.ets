// BASE_URL 是 App 访问 Backend 的唯一来源（模拟器经 10.0.2.2 访问宿主回环）。
// 2026-08-23 复核：本机安全软件同时拒绝 3000-3100 与 4000，4400 可绑定回环。
export class Constants {
  static readonly BASE_URL: string = 'http://10.0.2.2:4400';
}
