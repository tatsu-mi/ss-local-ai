import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "./env";
import type { Json } from "./database.types";
import { generateGroundedAnswer, isRetryableGeminiError } from "./gemini";
import { INSUFFICIENT_ANSWER } from "./grounded-answer";
import { AppError } from "./http";
import { searchQa, sourcesAreStillAccessible } from "./qa-service";
import { db, throwIfDbError } from "./supabase";
import type { Citation, CurrentUser, RagQa, StoredCitations } from "./types";

interface ChatRow {
  id: string;
  conversation_id: string;
  sequence_number: number;
  role: "user" | "assistant";
  content: string;
  citations: StoredCitations | null;
  created_at: string;
}

export async function answerQuestion(
  user: CurrentUser,
  question: string,
  requestedConversationId?: string,
) {
  const conversationId = requestedConversationId ?? randomUUID();
  const history = await safeConversationHistory(user, conversationId);
  const searchText = buildSearchText(question, history);

  await appendMessage(user.id, conversationId, "user", question, null);

  let candidates: RagQa[];
  try {
    candidates = await searchQa(user, searchText);
  } catch (error) {
    console.error("RAG search failed", error);
    throw new AppError(
      502,
      "関連情報の検索に失敗しました。回答は生成されていません。",
      "SEARCH_FAILED",
    );
  }

  const sources = candidates.slice(0, env().RAG_CONTEXT_COUNT);
  if (!sources.length) {
    const message = await appendMessage(user.id, conversationId, "assistant", INSUFFICIENT_ANSWER, {
      dependencies: [],
    });
    return { conversationId, message, citations: [], outcome: "insufficient" as const };
  }

  let generated;
  try {
    generated = await generateGroundedAnswer({ question, history, sources });
  } catch (error) {
    console.error("Grounded answer generation failed", error);
    if (isRetryableGeminiError(error)) {
      throw new AppError(
        503,
        "回答生成サービスが混雑しています。少し時間を置いてもう一度お試しください。回答は保存されていません。",
        "GENERATION_UNAVAILABLE",
      );
    }
    throw new AppError(
      502,
      "回答の生成または出典の検証に失敗しました。回答は保存されていません。",
      "GENERATION_FAILED",
    );
  }

  if (generated.status === "insufficient") {
    const message = await appendMessage(user.id, conversationId, "assistant", generated.answer, {
      dependencies: [],
    });
    return { conversationId, message, citations: [], outcome: "insufficient" as const };
  }

  if (!(await sourcesAreStillAccessible(user, sources))) {
    throw new AppError(
      409,
      "回答の生成中に参照情報または権限が変更されました。もう一度質問してください。",
      "SOURCE_CHANGED",
    );
  }

  const markersById = new Map<string, string[]>();
  for (const item of generated.citations) {
    const values = markersById.get(item.qaId) ?? [];
    if (!values.includes(item.marker)) values.push(item.marker);
    markersById.set(item.qaId, values);
  }
  const dependencies: Citation[] = sources.map((source) => ({
    qaId: source.id,
    revision: source.content_revision,
    question: source.question,
    answer: source.answer,
    markers: markersById.get(source.id) ?? [],
  }));
  const message = await appendMessage(
    user.id,
    conversationId,
    "assistant",
    generated.answer,
    { dependencies },
  );
  return {
    conversationId,
    message,
    citations: dependencies.filter((citation) => citation.markers.length > 0),
    outcome: "answered" as const,
  };
}

export async function listConversation(user: CurrentUser, conversationId: string) {
  const rows = await rawConversation(user.id, conversationId);
  const output: ChatRow[] = [];
  for (const row of rows) {
    if (row.role === "assistant" && row.citations) {
      if (!(await storedDependenciesAreAccessible(user, row.citations.dependencies))) continue;
    }
    output.push(row);
  }
  return output.map((row) => ({
    ...row,
    citations:
      row.citations?.dependencies.filter((citation) => citation.markers.length > 0) ?? [],
    outcome:
      row.role === "assistant" && row.citations?.dependencies.length === 0
        ? "insufficient" as const
        : row.role === "assistant"
          ? "answered" as const
          : undefined,
  }));
}

async function safeConversationHistory(user: CurrentUser, conversationId: string) {
  const rows = await rawConversation(user.id, conversationId);
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const row of rows) {
    if (
      row.role === "assistant" &&
      row.citations &&
      !(await storedDependenciesAreAccessible(user, row.citations.dependencies))
    ) {
      history.length = 0;
      continue;
    }
    history.push({ role: row.role, content: row.content });
  }
  return history.slice(-8);
}

async function storedDependenciesAreAccessible(user: CurrentUser, citations: Citation[]) {
  const sources: RagQa[] = citations.map((citation) => ({
    id: citation.qaId,
    question: citation.question,
    answer: citation.answer,
    category: null,
    tags: [],
    content_revision: citation.revision,
    required_rank: 0,
    similarity: 0,
  }));
  return sourcesAreStillAccessible(user, sources);
}

async function rawConversation(userId: string, conversationId: string) {
  const { data, error } = await db()
    .from("chat_log")
    .select("id, conversation_id, sequence_number, role, content, citations, created_at")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("sequence_number", { ascending: true })
    .limit(100);
  throwIfDbError(error);
  return (data ?? []) as ChatRow[];
}

async function appendMessage(
  userId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  citations: StoredCitations | null,
) {
  const { data, error } = await db().rpc("append_chat_message", {
    p_user_id: userId,
    p_conversation_id: conversationId,
    p_role: role,
    p_content: content,
    p_citations: citations as unknown as Json | null,
  });
  if (error?.message.includes("CONVERSATION_NOT_OWNED")) {
    throw new AppError(404, "会話が見つかりません。", "NOT_FOUND");
  }
  throwIfDbError(error);
  return data as ChatRow;
}

function buildSearchText(
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
) {
  if (!history.length) return question;
  const context = history
    .slice(-4)
    .map((item) => `${item.role === "user" ? "質問" : "回答"}: ${item.content}`)
    .join("\n");
  return `現在の質問: ${question}\n会話上の参照対象を特定するための文脈:\n${context}`;
}
