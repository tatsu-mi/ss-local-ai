import "server-only";
import { env } from "./env";
import { embedText } from "./gemini";
import { AppError } from "./http";
import { db, throwIfDbError } from "./supabase";
import type { CurrentUser, QaRecord, RagQa } from "./types";
import { embeddingDocument, normalizeTags, qaContentSchema } from "./validation";
import type { z } from "zod";

type QaContent = z.infer<typeof qaContentSchema>;

const publicQaColumns = [
  "id",
  "question",
  "answer",
  "category",
  "tags",
  "content_revision",
  "embedding_status",
  "required_permission_level_id",
  "status",
  "updated_by",
  "created_at",
  "updated_at",
  "updater:app_user!qa_updated_by_fkey(display_name)",
].join(",");

export async function listQa(user: CurrentUser, search = "") {
  let query = db()
    .from("qa")
    .select(`${publicQaColumns}, required_level:permission_level!inner(rank)`)
    .neq("status", "deleted")
    .lte("required_level.rank", user.permissionRank)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (!user.canManageQa) query = query.eq("status", "active");
  const safeSearch = search.trim().replace(/[,.()]/g, " ").slice(0, 200);
  if (safeSearch) {
    query = query.or(`question.ilike.%${safeSearch}%,answer.ilike.%${safeSearch}%`);
  }
  const { data, error } = await query;
  throwIfDbError(error);
  return data as unknown as QaRecord[];
}

export async function createQa(
  user: CurrentUser,
  input: QaContent & { id?: string; requiredPermissionLevelId: string },
) {
  const content = { ...input, tags: normalizeTags(input.tags) };
  assertEmbeddable(content);
  const { data, error } = await db()
    .from("qa")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      question: content.question,
      answer: content.answer,
      category: content.category || null,
      tags: content.tags,
      required_permission_level_id: input.requiredPermissionLevelId,
      updated_by: user.id,
    })
    .select(publicQaColumns)
    .single();
  if (error?.code === "23505" && input.id) {
    const { data: existing, error: existingError } = await db()
      .from("qa")
      .select(publicQaColumns)
      .eq("id", input.id)
      .maybeSingle();
    throwIfDbError(existingError);
    const existingRecord = existing as unknown as QaRecord | null;
    if (
      existingRecord &&
      existingRecord.question === content.question &&
      existingRecord.answer === content.answer &&
      existingRecord.category === (content.category || null) &&
      JSON.stringify(existingRecord.tags) === JSON.stringify(content.tags) &&
      existingRecord.required_permission_level_id === input.requiredPermissionLevelId
    ) {
      return existingRecord;
    }
    throw new AppError(409, "同じ登録IDが別のQAに使用されています。", "IDEMPOTENCY_CONFLICT");
  }
  throwIfDbError(error);
  if (!data) throw new Error("Created QA was not returned");
  const ready = await prepareEmbedding(data as unknown as QaRecord);
  return { ...(data as unknown as QaRecord), embedding_status: ready ? "ready" : "failed" };
}

export async function updateQaContent(
  user: CurrentUser,
  id: string,
  input: QaContent & { expectedRevision: number },
) {
  const content = { ...input, tags: normalizeTags(input.tags) };
  assertEmbeddable(content);
  const { data, error } = await db().rpc("update_qa_content", {
    p_qa_id: id,
    p_expected_revision: input.expectedRevision,
    p_question: content.question,
    p_answer: content.answer,
    p_category: content.category,
    p_tags: content.tags,
    p_updated_by: user.id,
  });
  if (error?.message.includes("QA_NOT_FOUND_OR_REVISION_CONFLICT")) {
    throw new AppError(409, "QAがほかで更新されました。再読み込みしてください。", "REVISION_CONFLICT");
  }
  throwIfDbError(error);
  const record = data as unknown as QaRecord;
  if (record.status !== "active") return record;
  const ready = await prepareEmbedding(record);
  return { ...record, embedding_status: ready ? "ready" : "failed" };
}

export async function updateQaAccess(user: CurrentUser, id: string, levelId: string) {
  const { data, error } = await db()
    .from("qa")
    .update({
      required_permission_level_id: levelId,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .neq("status", "deleted")
    .select(publicQaColumns)
    .maybeSingle();
  throwIfDbError(error);
  if (!data) throw new AppError(404, "QAが見つかりません。", "NOT_FOUND");
  return data as unknown as QaRecord;
}

export async function updateQaStatus(
  user: CurrentUser,
  id: string,
  status: "active" | "excluded" | "deleted",
) {
  const { data, error } = await db()
    .from("qa")
    .update({ status, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", id)
    .neq("status", "deleted")
    .select(publicQaColumns)
    .maybeSingle();
  throwIfDbError(error);
  if (!data) throw new AppError(404, "QAが見つかりません。", "NOT_FOUND");
  const record = data as unknown as QaRecord;
  if (status === "active" && record.embedding_status !== "ready") {
    const ready = await retryEmbedding(user, id);
    return { ...record, embedding_status: ready ? "ready" : "failed" };
  }
  return record;
}

export async function retryEmbedding(user: CurrentUser, id: string) {
  const { data, error } = await db().rpc("prepare_qa_embedding_retry", {
    p_qa_id: id,
    p_updated_by: user.id,
  });
  throwIfDbError(error);
  if (!data) throw new AppError(409, "このQAは再試行できる状態ではありません。", "NOT_RETRYABLE");
  return prepareEmbedding(data as unknown as QaRecord);
}

export async function searchQa(user: CurrentUser, queryText: string): Promise<RagQa[]> {
  const queryEmbedding = await embedText(queryText, "query");
  const config = env();
  const { data, error } = await db().rpc("match_qa", {
    p_query_embedding: queryEmbedding,
    p_user_rank: user.permissionRank,
    p_profile: config.GEMINI_EMBEDDING_PROFILE,
    p_match_threshold: config.RAG_SIMILARITY_THRESHOLD,
    p_match_count: config.RAG_CANDIDATE_COUNT,
  });
  throwIfDbError(error);
  return (data ?? []) as RagQa[];
}

export async function sourcesAreStillAccessible(user: CurrentUser, sources: RagQa[]) {
  if (!sources.length) return true;
  const { data, error } = await db()
    .from("qa")
    .select("id, content_revision, status, embedding_status, embedding_revision, embedding_profile, required_level:permission_level!inner(rank)")
    .in("id", sources.map((source) => source.id))
    .eq("status", "active")
    .lte("required_level.rank", user.permissionRank);
  throwIfDbError(error);
  if (!data) return false;
  if (data.length !== sources.length) return false;
  const current = new Map(data.map((row) => [row.id as string, row]));
  return sources.every((source) => {
    const row = current.get(source.id);
    return Boolean(
      row &&
      row.content_revision === source.content_revision &&
      row.embedding_status === "ready" &&
      row.embedding_revision === row.content_revision &&
      row.embedding_profile === env().GEMINI_EMBEDDING_PROFILE,
    );
  });
}

function assertEmbeddable(content: QaContent) {
  if (embeddingDocument(content).length > env().MAX_QA_EMBEDDING_CHARS) {
    throw new AppError(
      400,
      "QAが長すぎます。内容を複数のQAに分けてください。",
      "QA_TOO_LONG",
    );
  }
}

async function prepareEmbedding(qa: QaRecord) {
  try {
    const vector = await embedText(
      embeddingDocument({
        question: qa.question,
        answer: qa.answer,
        category: qa.category ?? "",
        tags: qa.tags,
      }),
      "document",
    );
    const { data, error } = await db().rpc("complete_qa_embedding", {
      p_qa_id: qa.id,
      p_revision: qa.content_revision,
      p_profile: env().GEMINI_EMBEDDING_PROFILE,
      p_embedding: vector,
    });
    throwIfDbError(error);
    return data === true;
  } catch (error) {
    console.error("Embedding preparation failed", { qaId: qa.id, revision: qa.content_revision, error });
    const { error: markError } = await db().rpc("fail_qa_embedding", {
      p_qa_id: qa.id,
      p_revision: qa.content_revision,
    });
    throwIfDbError(markError);
    return false;
  }
}
