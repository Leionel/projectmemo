import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual ArkTS service with native HTTP replaced; no device or network writes.
function serviceHarness(status: number, result: string | ArrayBuffer = '{"isDuplicate":false}') {
  const request = vi.fn().mockResolvedValue({ responseCode: status, result });
  const destroy = vi.fn();
  const expired = vi.fn();
  class ApiError extends Error {
    constructor(public code: string, message: string, public status: number) { super(message); }
  }
  const modules: Record<string, object> = {
    "./ApiClient": { ApiClient: class {} },
    "../models/Attachment": { Attachment: class {} },
    "../models/Project": { ApiError },
    "@ohos.net.http": { default: { createHttp: () => ({ request, destroy }), RequestMethod: { POST: "POST", GET: "GET" }, HttpDataType: { STRING: "STRING", ARRAY_BUFFER: "ARRAY_BUFFER" } } },
    "../common/Constants": { Constants: { requireBaseUrl: () => "https://test.invalid" } },
    "../common/ApiContract": { isSuccessCode: (_: string, code: number) => code === 201, parseApiError: () => new Error("API error") },
    "./SessionStore": { SessionStore: { getToken: () => "test-session", handleSessionExpired: expired } },
  };
  const presentation = fs.readFileSync("harmonyos/entry/src/main/ets/common/AttachmentPresentation.ets", "utf8");
  const presentationExports = {};
  vm.runInNewContext(ts.transpileModule(presentation, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: presentationExports });
  modules["../common/AttachmentPresentation"] = presentationExports;
  const source = fs.readFileSync("harmonyos/entry/src/main/ets/services/AttachmentService.ets", "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports: { AttachmentService?: new () => { upload: (...args: string[]) => Promise<unknown>; original: (...args: string[]) => Promise<ArrayBuffer> } } = {};
  vm.runInNewContext(outputText, { exports, require: (name: string) => {
    if (!modules[name]) throw new Error(`Unexpected dependency ${name}`);
    return modules[name];
  } });
  return { service: new exports.AttachmentService!(), request, destroy, expired };
}

describe("Harmony multipart authentication", () => {
  it("sends the session without overriding the multipart content type", async () => {
    const h = serviceHarness(201);
    await h.service.upload("project", "file://test", "test.txt", "text/plain");
    expect(h.request.mock.calls[0][1].header).toEqual({ Authorization: "Bearer test-session" });
    expect(h.request.mock.calls[0][1].multiFormDataList[0].name).toBe("file");
    expect(h.destroy).toHaveBeenCalledOnce();
  });
  it("expires the session on 401 and releases the native request", async () => {
    const h = serviceHarness(401);
    await expect(h.service.upload("project", "file://test", "test.txt", "text/plain")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(h.expired).toHaveBeenCalledOnce();
    expect(h.destroy).toHaveBeenCalledOnce();
  });
  it("downloads original bytes with session headers and encoded path segments", async () => {
    const bytes = new Uint8Array([0, 127, 255]).buffer;
    const h = serviceHarness(200, bytes);
    expect(await h.service.original("project/a", "file?b")).toBe(bytes);
    const [url, options] = h.request.mock.calls[0];
    expect(url).toBe("https://test.invalid/api/projects/project%2Fa/attachments/file%3Fb/file");
    expect(options).toMatchObject({ method: "GET", header: { Authorization: "Bearer test-session" }, expectDataType: "ARRAY_BUFFER", usingCache: false });
    expect(h.destroy).toHaveBeenCalledOnce();
  });
  it.each([[401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"]])("preserves original-file HTTP %s failures and releases the request", async (status, code) => {
    const h = serviceHarness(status);
    await expect(h.service.original("project", "attachment")).rejects.toMatchObject({ code });
    expect(h.expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    expect(h.destroy).toHaveBeenCalledOnce();
  });
  it("rejects empty original files", async () => {
    const h = serviceHarness(200, new ArrayBuffer(0));
    await expect(h.service.original("project", "attachment")).rejects.toMatchObject({ code: "INVALID_FILE_SIZE" });
    expect(h.destroy).toHaveBeenCalledOnce();
  });
});
