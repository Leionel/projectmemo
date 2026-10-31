import { z } from "zod";

export const browserReadModeSchema = z.enum(["READ_VISIBLE", "READ_DETAILS"]);
export type BrowserReadMode = z.infer<typeof browserReadModeSchema>;

export const browserRenderCoverageSchema = z.object({
  complete: z.boolean(), visibleCharacters: z.number().int().nonnegative(), totalCharacters: z.number().int().nonnegative(),
  truncated: z.boolean(), scrolls: z.number().int().nonnegative(), pages: z.literal(1),
  requests: z.number().int().nonnegative(), blockedRequests: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(),
}).strict();
export type BrowserRenderCoverage = z.infer<typeof browserRenderCoverageSchema>;

export const browserLocatorSchema = z.object({
  selector: z.literal("body"), headingPath: z.array(z.string().max(200)).max(4),
  quote: z.string().max(400), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), textHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type BrowserLocator = z.infer<typeof browserLocatorSchema>;

export const browserObservationSchema = z.object({
  status: z.enum(["RENDERED", "PARTIAL", "EMPTY", "BLOCKED", "FAILED"]),
  requestedUrl: z.string().max(8192), finalUrl: z.string().max(8192), title: z.string().max(300),
  observedAt: z.string().datetime(), renderMs: z.number().int().nonnegative(),
  readyState: z.enum(["loading", "interactive", "complete", "unknown"]),
  mode: browserReadModeSchema, visibleText: z.string().max(12000), headings: z.array(z.object({ level: z.number().int().min(1).max(3), text: z.string().max(200) }).strict()).max(24),
  locator: browserLocatorSchema, coverage: browserRenderCoverageSchema,
  screenshotHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  failure: z.object({ code: z.string().max(80), message: z.string().max(300) }).strict().nullable(),
}).strict();
export type BrowserObservation = z.infer<typeof browserObservationSchema>;

/** Additive provenance stored next to a saved web source; it contains no page content beyond the existing excerpt. */
export const browserSourceMetaSchema = z.object({
  renderer: z.literal("ISOLATED_BROWSER"), version: z.literal(1),
  status: z.enum(["RENDERED", "PARTIAL", "EMPTY", "BLOCKED", "FAILED"]),
  requestedUrl: z.string().max(8192), finalUrl: z.string().max(8192), observedAt: z.string().datetime(), renderMs: z.number().int().nonnegative(),
  mode: browserReadModeSchema, readyState: z.enum(["loading", "interactive", "complete", "unknown"]),
  coverage: browserRenderCoverageSchema, locator: browserLocatorSchema, screenshotHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  failureCode: z.string().max(80).nullable(), failureMessage: z.string().max(300).nullable(),
}).strict();
export type BrowserSourceMeta = z.infer<typeof browserSourceMetaSchema>;

export type BrowserReadLimits = { maxRequests: number; maxBytes: number; maxRenderMs: number; maxScrolls: number };
export const DEFAULT_BROWSER_LIMITS: BrowserReadLimits = { maxRequests: 24, maxBytes: 4_000_000, maxRenderMs: 12_000, maxScrolls: 2 };
export type BrowserReadRequest = {
  url: string; allowedHosts: string[]; mode: BrowserReadMode; scrolls: number; limits: BrowserReadLimits;
};
export interface BrowserReader {
  name: string;
  read(request: BrowserReadRequest, options: { signal: AbortSignal; beforeRequest?:()=>Promise<void> }): Promise<BrowserObservation>;
}
