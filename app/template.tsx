/** 路由切换只淡入不淡出；只动 opacity，不影响内部 sticky 与 fixed 定位。 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="route-enter">{children}</div>;
}
