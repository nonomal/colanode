import { z } from 'zod';

export const rerankedDocumentsSchema = z.object({
  rankings: z.array(
    z.object({
      index: z.number(),
      score: z.number().describe('Relevance score (0-1 float)'),
      type: z.string().describe('Document type'),
      sourceId: z.string().describe('Original source ID'),
    })
  ),
});
export type RerankedDocuments = z.infer<typeof rerankedDocumentsSchema>;

export const citedAnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({
      sourceId: z.string(),
      quote: z.string(),
    })
  ),
});
export type CitedAnswer = z.infer<typeof citedAnswerSchema>;

export const databaseFilterSchema = z.object({
  shouldFilter: z.boolean(),
  filters: z.array(
    z.object({
      databaseId: z.string(),
      filters: z.array(z.any()),
    })
  ),
});
export type DatabaseFilterResult = z.infer<typeof databaseFilterSchema>;

export const rewrittenQuerySchema = z.object({
  semanticQuery: z.string(),
  keywordQuery: z.string(),
});

export type RewrittenQuery = z.infer<typeof rewrittenQuerySchema>;

// NEW Schema for combined evaluation and refinement
export const evaluateAndRefineSchema = z.object({
  decision: z.enum(['sufficient', 'insufficient']),
  newSemantic: z.string().optional(),
  expandSourceIds: z.array(z.string()).optional(),
});
export type EvaluateAndRefineResult = z.infer<typeof evaluateAndRefineSchema>;
