// BASE_URL 是 App 访问 Backend 的唯一来源（模拟器经 10.0.2.2 访问宿主回环）。
// 注意：本机安全软件拦截 3000-3100 段监听，故使用 4000 端口；如无拦截可改回 3000。
export class Constants {
  static readonly BASE_URL: string = 'http://10.0.2.2:4000';
}
