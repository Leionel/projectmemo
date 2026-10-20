import {z} from "zod";
export const searchResponseSchema=z.object({results:z.array(z.object({url:z.string().max(8192),title:z.string().max(2000),snippet:z.string().max(20000).default(""),date:z.string().nullable().optional(),site_name:z.string().nullable().optional()})).max(50)});
export const fetchResponseSchema=z.object({title:z.string().max(2000),content:z.string().min(1).max(524288)});
export type SearchHit=z.infer<typeof searchResponseSchema>["results"][number];
export interface ResearchProvider{ name:string; search(query:string):Promise<SearchHit[]>;fetchPage(url:string):Promise<{title:string;content:string}>; }
export type Observation={id:string;requestedUrl:string;retrievalMode:"SEARCH_SNIPPET"|"PROVIDER_EXTRACT";title:string;publisher:string|null;publishedAt:string|null;normalizedContentHash:string;excerpt:{schemaVersion:1;text:string;start:number;end:number;truncated:boolean};};
