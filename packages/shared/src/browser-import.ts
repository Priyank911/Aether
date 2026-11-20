import { z } from 'zod';

export const ImportSelectionSchema = z.object({ bookmarks: z.boolean(), history: z.boolean(), cookies: z.boolean() }).refine(value => value.bookmarks || value.history || value.cookies, 'Choose at least one data type');
export const ImportProfileSchema = z.object({ id: z.string().uuid(), name: z.string().max(256), browser: z.literal('Chrome') });
export const ImportKindSchema = z.enum(['bookmarks', 'history', 'cookies']);
export const ImportReasonSchema = z.enum(['missing-file', 'source-busy', 'invalid-data', 'read-failed', 'write-failed', 'already-present', 'expired', 'app-bound', 'encryption-unavailable', 'partitioned-cookie']);
const CountsSchema = z.object({ imported: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() });
export const ImportReportSchema = z.object({
  bookmarks: CountsSchema, history: CountsSchema, cookies: CountsSchema,
  issues: z.array(z.object({ kind: ImportKindSchema, reason: ImportReasonSchema, count: z.number().int().positive() })),
  temporaryCopiesRemoved: z.boolean(),
});
export const ImportStateSchema = z.object({
  profiles: z.array(ImportProfileSchema), busy: z.boolean(), offer: z.boolean(),
  report: ImportReportSchema.optional(), error: z.string().max(500).optional(),
});
export type ImportSelection = z.infer<typeof ImportSelectionSchema>;
export type ImportProfile = z.infer<typeof ImportProfileSchema>;
export type ImportKind = z.infer<typeof ImportKindSchema>;
export type ImportReason = z.infer<typeof ImportReasonSchema>;
export type ImportReport = z.infer<typeof ImportReportSchema>;
export type ImportState = z.infer<typeof ImportStateSchema>;
