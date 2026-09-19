import { z } from "zod";

export const RenderFormatSchema = z.enum(["pdf", "pptx"]);
export type RenderFormat = z.infer<typeof RenderFormatSchema>;

export const RenderTemplateSchema = z.enum([
  "sales-report",
  "expense-report",
  "meeting-minutes",
]);
export type RenderTemplate = z.infer<typeof RenderTemplateSchema>;

export const RenderTableSchema = z.object({
  headers: z.array(z.string()).min(1).max(50),
  rows: z.array(z.array(z.string())).max(500),
});

export const RenderBlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("heading"),
    text: z.string().min(1).max(500),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  }),
  z.object({
    kind: z.literal("markdown"),
    text: z.string().min(1).max(200_000),
  }),
  z.object({
    kind: z.literal("table"),
    title: z.string().max(300).optional(),
    table: RenderTableSchema,
  }),
  z.object({
    kind: z.literal("keyValue"),
    items: z
      .array(
        z.object({
          key: z.string().max(200),
          value: z.string().max(1000),
        }),
      )
      .max(100),
  }),
]);

export const RenderRequestSchema = z.object({
  format: RenderFormatSchema,
  template: RenderTemplateSchema,
  title: z.string().min(1).max(300),
  blocks: z.array(RenderBlockSchema).min(1).max(200),
  locale: z.enum(["ru", "en"]).default("ru"),
  generatedAt: z.string().datetime().optional(),
  /** Opaque payload for templates that still need structured domain data */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type RenderRequest = z.infer<typeof RenderRequestSchema>;
