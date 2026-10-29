import type { z } from "zod";

/** Null root annotations carry no facts or instructions. Nested fields and all non-null extras remain strict. */
export function parseReviewJSON<T>(content: string, schema: z.ZodType<T>) {
  const original = JSON.parse(content) as unknown;
  const declared = schema.toJSONSchema().properties ?? {};
  const extras = original && typeof original === "object" && !Array.isArray(original)
    ? Object.entries(original).filter(([key]) => !Object.hasOwn(declared, key)) : [];
  const ignoredNullFields = extras.length <= 4 && extras.every(([, value]) => value === null) ? extras.map(([key]) => key) : [];
  const value = ignoredNullFields.length ? Object.fromEntries(Object.entries(original as Record<string, unknown>).filter(([key]) => !ignoredNullFields.includes(key))) : original;
  return { data: schema.parse(value), ignoredNullFields };
}
