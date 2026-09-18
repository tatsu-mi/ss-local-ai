import "server-only";
import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  GEMINI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  GEMINI_EMBEDDING_PROFILE: z.string().default("gemini-embedding-001:768:retrieval-v1"),
  GEMINI_GENERATION_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_GENERATION_FALLBACK_MODEL: z.string().trim().min(1).default("gemini-3.6-flash"),
  GEMINI_GENERATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(4),
  GEMINI_EMBEDDING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(4),
  GEMINI_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).max(5_000).default(1_000),
  GEMINI_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(8_000),
  RAG_SIMILARITY_THRESHOLD: z.coerce.number().min(-1).max(1).default(0.7),
  RAG_CANDIDATE_COUNT: z.coerce.number().int().min(1).max(50).default(10),
  RAG_CONTEXT_COUNT: z.coerce.number().int().min(1).max(5).default(5),
  MAX_QA_EMBEDDING_CHARS: z.coerce.number().int().positive().default(1_800),
  MAX_PDF_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
});

let cached: z.infer<typeof schema> | undefined;

export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
