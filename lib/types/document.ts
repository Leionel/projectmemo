import { z } from "zod";
const base={projectId:z.string().min(1).max(160),sourceId:z.string().regex(/^attachment:[^/]{1,160}$/),revision:z.string().min(1).max(160)};
export const documentToolSchemas=[
  z.object({...base,tool:z.literal("inspect_document"),page:z.number().int().min(1).max(10000).optional()}).strict(),
  z.object({...base,tool:z.literal("read_document_page"),page:z.number().int().min(1).max(10000)}).strict(),
  z.object({...base,tool:z.literal("read_document_section"),sectionId:z.string().min(1).max(100),page:z.number().int().min(1).max(10000).optional()}).strict(),
  z.object({...base,tool:z.literal("read_document_table"),tableId:z.string().min(1).max(100),page:z.number().int().min(1).max(10000).optional()}).strict(),
] as const;
export const documentCallSchema=z.discriminatedUnion("tool",documentToolSchemas);
export type DocumentCall=z.infer<typeof documentToolSchemas[number]>;
export type DocumentMeta={attachmentId:string;fileName:string;attachmentHash:string;fileHash:string;revisionId:string|null;parser:string;kind:"CATALOG"|"PAGE"|"SECTION"|"TABLE";locatorId:string;pages:number[];span?:{start:number;end:number;coordinate:"EXTRACTED_PAGE_UTF16"|"CORRECTED_TEXT_UTF16"};pageMapping:"PHYSICAL_PDF"|"CORRECTED_TEXT_UNMAPPED";observedAt:string;conversationId?:string;turnId?:string;missionId?:string};
export type DocumentSection={id:string;title:string;page:number|null;start:number;end:number};
export type DocumentCatalog={sections:Array<{id:string;title:string;page:number|null}>;tables:Array<{id:string;page:number|null}>;pageCount:number|null;parser:string};
export type DocumentTable={id:string;page:number|null;start:number;end:number;rows:string[][];headerStatus:"UNCONFIRMED";structureStatus:"TEXT_LAYOUT_CANDIDATE"};
