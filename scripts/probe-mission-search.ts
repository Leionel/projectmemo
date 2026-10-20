if (!process.argv.includes("--live")) console.log(JSON.stringify({ mode: "DRY_RUN", searchVerified: false, liveRequires: "--live --confirm-cost", topics: ["TypeScript 官方文档", "无匹配资料", "来源失效"] }));
else {
  if (!process.argv.includes("--confirm-cost")) throw new Error("真实搜索探针需要授权额度");
  const key = process.env.MISSION_SEARCH_API_KEY ?? process.env.LLM_API_KEY;
  if (!key) throw new Error("未配置搜索凭据");
  const response = await fetch("https://api.deepseek.com/v1/tools/search", { method: "POST", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ query: "TypeScript site:typescriptlang.org", count: 3, need_content: false }) });
  const value = await response.json(); console.log(JSON.stringify({ status: response.status, results: value.results?.map((r: { title: string; url: string }) => ({ title: r.title, url: r.url })) }));
}
export {};
