// Phase 0 baseline route probe: anonymous (no cookie) redirect chains.
// Read-only: GET only, no login attempts, no credentials.
const BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:34111";
const OUT = new URL("../json/routes-baseline.json", import.meta.url);

async function probe(pathname, maxHops = 8) {
  const chain = [];
  let url = new URL(pathname, BASE).toString();
  let finalUrl = url;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(url, { redirect: "manual", headers: { "user-agent": "claims-auditor-phase0/1.0" } });
    const location = res.headers.get("location");
    chain.push({
      requestUrl: url,
      status: res.status,
      location: location || null,
      contentType: res.headers.get("content-type"),
    });
    if (!location) {
      finalUrl = url;
      break;
    }
    finalUrl = new URL(location, url).toString();
    url = finalUrl;
  }
  return { input: pathname, hops: chain.length, chain, finalUrl };
}

const paths = ["/", "/focus", "/focus?from=%2Fhome", "/login?from=%2Ffocus", "/login"];
const results = [];
for (const p of paths) {
  try {
    results.push({ ok: true, ...(await probe(p)) });
  } catch (err) {
    results.push({ ok: false, input: p, error: String(err && err.message ? err.message : err) });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  mode: "anonymous-no-cookie-read-only",
  results,
};
const fs = await import("node:fs");
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
for (const r of results) {
  if (!r.ok) {
    console.log(`[ERR] ${r.input}: ${r.error}`);
    continue;
  }
  const tail = r.chain.map((h) => `${h.status}${h.location ? " -> " + h.location : ""}`).join(" | ");
  console.log(`${r.input}: ${tail}  FINAL=${r.finalUrl}`);
}
console.log("wrote " + OUT.pathname);
