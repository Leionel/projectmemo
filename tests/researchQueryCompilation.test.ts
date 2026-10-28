import { expect, test } from "vitest";
import { compilePublicQuery } from "@/lib/research/queryPolicy";
const scope = { enabled: true, topic: "MCP official specification", publicTerms: ["MCP"], allowedHosts: ["modelcontextprotocol.io"], allowedCategories: ["PUBLIC_TOPIC"], excludedTerms: ["private-project"] };
test.each([
 "MCP Model Context Protocol official specification tools authorization site:modelcontextprotocol.io",
 "MCP Model Context Protocol official specification tools authorization site:modelcontextprotocol.io lang:en",
 "MCP Model Context Protocol official specification tools authorization (site:modelcontextprotocol.io)",
])("compile exact approved filters once: %s", query => {
 const compiled = compilePublicQuery(query,scope,"lang:en (site:modelcontextprotocol.io)");
 expect([...compiled].length).toBeLessThanOrEqual(128);
 expect(compiled.match(/site:/g)).toHaveLength(1); expect(compiled.match(/lang:/g)).toHaveLength(1);
});
test("unapproved conditions, private terms, URLs and credentials remain blocked before HTTP", () => {
 for(const query of ["MCP site:unapproved.example", "MCP private-project", "MCP https://private.example/a", "MCP password=secret", "MCP token:secret", "MCP %73%6b-secret"])
   expect(()=>compilePublicQuery(query,scope,"(site:modelcontextprotocol.io)")).toThrow();
 expect(()=>compilePublicQuery("MCP "+"x".repeat(128),scope,"(site:modelcontextprotocol.io)")).toThrowError(/过长/);
});
