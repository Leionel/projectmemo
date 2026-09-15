// 后端地址的唯一配置来源。
// BUILD_FLAVOR=development 仅用于本机 DevEco 模拟器；10.0.2.2 不能作为评审包地址。
// 生成评审包前，必须将 BUILD_FLAVOR 改为 review 并填入真实 HTTPS 地址。
// 空的 REVIEW_BASE_URL 或开发机回环地址会被 requireBaseUrl() 拒绝。
export class Constants {
  static readonly BUILD_FLAVOR: string = 'development';
  static readonly DEVELOPMENT_BASE_URL: string = 'http://10.0.2.2:4400';
  static readonly REVIEW_BASE_URL: string = '';
  static readonly BASE_URL: string = Constants.BUILD_FLAVOR === 'review'
    ? Constants.REVIEW_BASE_URL
    : Constants.DEVELOPMENT_BASE_URL;

  static requireBaseUrl(): string {
    const baseUrl: string = Constants.BASE_URL.trim();
    if (baseUrl.length === 0) {
      throw new Error('评审构建未配置后端地址，请填写 Constants.REVIEW_BASE_URL');
    }
    if (Constants.BUILD_FLAVOR === 'review' && (
      baseUrl.indexOf('10.0.2.2') >= 0 ||
      baseUrl.indexOf('localhost') >= 0 ||
      baseUrl.indexOf('127.0.0.1') >= 0
    )) {
      throw new Error('评审构建不能使用模拟器或本机回环地址');
    }
    return baseUrl.replace(/\/$/, '');
  }
}
