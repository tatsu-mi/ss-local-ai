export const PERMISSION_LEVEL_IDS = {
  unset: "00000000-0000-0000-0000-000000000001",
  engineer: "00000000-0000-0000-0000-000000000002",
  backoffice: "00000000-0000-0000-0000-000000000003",
} as const;

export const DEFAULT_PERMISSION_GROUP_ID =
  "10000000-0000-0000-0000-000000000002";

export const QA_MAX_QUESTION_CHARS = 2_000;
export const QA_MAX_ANSWER_CHARS = 10_000;
export const MAX_CHAT_CHARS = 4_000;

export type QaStatus = "active" | "excluded" | "deleted";
export type EmbeddingStatus = "pending" | "ready" | "failed";
