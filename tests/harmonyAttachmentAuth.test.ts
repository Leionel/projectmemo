import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual ArkTS service with native HTTP replaced; no device or network writes.
function serviceHarness(status: number) {
  const request = vi.fn().mockResolvedValue({ responseCode: status, result: '{"isDuplicate":false}' });
  const destroy = vi.fn();
  const expired = vi.fn();
  class ApiError extends Error {
    constructor(public code: string, message: string, public status: number) { super(message); }
  }
  const modules: Record<string, object> = {
    "./ApiClient": { ApiClient: class {} },
    "../models/Attachment": { Attachment: class {} },
    "../models/Project": { ApiError },
    "@ohos.net.http": { default: { createHttp: () => ({ request, destroy }), RequestMethod: { POST: "POST" }, HttpDataType: { STRING: "STRING" } } },
    "../common/Constants": { Constants: { requireBaseUrl: () => "https://test.invalid" } },
    "../common/ApiContract": { isSuccessCode: (_: string, code: number) => code === 201, parseApiError: () => new Error("API error") },
    "./SessionStore": { SessionStore: { getToken: () => "test-session", handleSessionExpired: expired } },
  };
  const source = fs.readFileSync("harmonyos/entry/src/main/ets/services/AttachmentService.ets", "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports: { AttachmentService?: new () => { upload: (...args: string[]) => Promise<unknown> } } = {};
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
});
