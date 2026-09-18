import { z } from "zod";
import {
  MAX_CHAT_CHARS,
  PERMISSION_LEVEL_IDS,
  QA_MAX_ANSWER_CHARS,
  QA_MAX_QUESTION_CHARS,
} from "./constants";

const trimmedRequired = (max: number, label: string) =>
  z.string().trim().min(1, `${label}を入力してください`).max(max, `${label}が長すぎます`);

export const qaContentSchema = z.object({
  question: trimmedRequired(QA_MAX_QUESTION_CHARS, "質問"),
  answer: trimmedRequired(QA_MAX_ANSWER_CHARS, "回答"),
  category: z.string().trim().max(200).optional().default(""),
  tags: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
});

export const createQaSchema = qaContentSchema.extend({
  id: z.uuid().optional(),
  requiredPermissionLevelId: z
    .enum([PERMISSION_LEVEL_IDS.engineer, PERMISSION_LEVEL_IDS.backoffice])
    .default(PERMISSION_LEVEL_IDS.backoffice),
});

export const updateQaSchema = z.discriminatedUnion("kind", [
  qaContentSchema.extend({
    kind: z.literal("content"),
    expectedRevision: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("access"),
    requiredPermissionLevelId: z.enum([
      PERMISSION_LEVEL_IDS.engineer,
      PERMISSION_LEVEL_IDS.backoffice,
    ]),
  }),
  z.object({
    kind: z.literal("status"),
    status: z.enum(["active", "excluded", "deleted"]),
  }),
]);

export const chatRequestSchema = z.object({
  conversationId: z.uuid().optional(),
  question: trimmedRequired(MAX_CHAT_CHARS, "質問"),
});

export const updateUserSchema = z.object({
  // Seeded group IDs are valid PostgreSQL UUIDs, but intentionally do not
  // encode an RFC UUID version/variant. z.guid() validates the canonical
  // 8-4-4-4-12 shape without rejecting those existing database IDs.
  permissionGroupId: z.guid(),
});

export function normalizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

export function embeddingDocument(input: z.infer<typeof qaContentSchema>) {
  const lines = [`質問: ${input.question}`, `回答: ${input.answer}`];
  if (input.category) lines.push(`カテゴリ: ${input.category}`);
  if (input.tags.length) lines.push(`タグ: ${normalizeTags(input.tags).join(", ")}`);
  return lines.join("\n");
}
