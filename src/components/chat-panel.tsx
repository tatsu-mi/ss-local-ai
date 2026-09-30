"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, jsonRequest } from "./api";

interface Source {
  qaId: string;
  revision: number;
  question: string;
  answer: string;
  markers: string[];
}

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Source[];
  outcome?: "answered" | "insufficient";
}

interface ConversationSummary {
  conversationId: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

function citationTargetId(messageIndex: number, marker: string) {
  return `message-${messageIndex}-source-${marker.slice(2, -1)}`;
}

function messageContent(message: Message, messageIndex: number) {
  const markers = new Set(message.citations?.flatMap((source) => source.markers) ?? []);
  if (!markers.size) return message.content;

  return message.content.split(/(\[S\d+\])/g).map((part, partIndex) =>
    markers.has(part) ? (
      <a
        className="citation-link"
        href={`#${citationTargetId(messageIndex, part)}`}
        aria-label={`${part} の出典へ移動`}
        onClick={() => {
          const target = document.getElementById(citationTargetId(messageIndex, part));
          const details = target?.closest("details");
          if (details instanceof HTMLDetailsElement) details.open = true;
        }}
        key={`${part}-${partIndex}`}
      >
        {part}
      </a>
    ) : part,
  );
}

const historyDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function ChatPanel() {
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingConversationId, setLoadingConversationId] = useState<string>();
  const [deletingConversationId, setDeletingConversationId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const task = window.setTimeout(async () => {
      try {
        const history = await api<{ conversations: ConversationSummary[] }>("/api/chat");
        if (cancelled) return;
        setConversations(history.conversations);

        const stored = window.localStorage.getItem("local-ai-conversation");
        if (!stored || !history.conversations.some((item) => item.conversationId === stored)) {
          window.localStorage.removeItem("local-ai-conversation");
          return;
        }

        try {
          const result = await api<{ messages: Message[] }>(
            `/api/chat?conversationId=${encodeURIComponent(stored)}`,
          );
          if (cancelled) return;
          setConversationId(stored);
          setMessages(result.messages);
        } catch (caught) {
          window.localStorage.removeItem("local-ai-conversation");
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : "会話の読み込みに失敗しました。");
          }
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "会話履歴の読み込みに失敗しました。");
        }
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(task);
    };
  }, []);

  async function refreshConversations() {
    try {
      const result = await api<{ conversations: ConversationSummary[] }>("/api/chat");
      setConversations(result.conversations);
    } catch {
      // A failed refresh must not discard a successfully generated answer.
    }
  }

  async function openConversation(id: string) {
    if (busy || loadingConversationId) return;
    setLoadingConversationId(id);
    setError("");
    try {
      const result = await api<{ messages: Message[] }>(
        `/api/chat?conversationId=${encodeURIComponent(id)}`,
      );
      setConversationId(id);
      setMessages(result.messages);
      window.localStorage.setItem("local-ai-conversation", id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "会話の読み込みに失敗しました。");
    } finally {
      setLoadingConversationId(undefined);
    }
  }

  async function removeConversation(item: ConversationSummary) {
    if (
      busy ||
      deletingConversationId ||
      !window.confirm(`「${item.title}」を削除しますか？\nこの操作は取り消せません。`)
    ) return;

    setDeletingConversationId(item.conversationId);
    setError("");
    try {
      await api<void>(`/api/chat?conversationId=${encodeURIComponent(item.conversationId)}`, {
        method: "DELETE",
      });
      setConversations((current) =>
        current.filter((conversation) => conversation.conversationId !== item.conversationId),
      );
      if (conversationId === item.conversationId) reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "会話の削除に失敗しました。");
    } finally {
      setDeletingConversationId(undefined);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = question.trim();
    if (!value || busy) return;
    setMessages((current) => [...current, { role: "user", content: value }]);
    setQuestion("");
    setBusy(true);
    setError("");
    const activeConversationId = conversationId ?? crypto.randomUUID();
    setConversationId(activeConversationId);
    window.localStorage.setItem("local-ai-conversation", activeConversationId);
    try {
      const result = await api<{
        conversationId: string;
        message: { content: string };
        citations: Source[];
        outcome: "answered" | "insufficient";
      }>("/api/chat", jsonRequest("POST", { conversationId: activeConversationId, question: value }));
      setConversationId(result.conversationId);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: result.message.content, citations: result.citations, outcome: result.outcome },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "回答に失敗しました。");
    } finally {
      setBusy(false);
      void refreshConversations();
    }
  }

  function reset() {
    setConversationId(undefined);
    setMessages([]);
    setError("");
    window.localStorage.removeItem("local-ai-conversation");
  }

  return (
    <div className="panel chat-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">ASK THE KNOWLEDGE BASE</p>
          <h1>チャット</h1>
          <p>回答内の [S番号] は回答ごとに [S1] から始まり、対応する出典QAを示します。</p>
        </div>
        <button className="secondary" onClick={reset} disabled={!conversationId && !messages.length}>新しい会話</button>
      </div>
      <div className="chat-workspace">
        <aside className="conversation-history" aria-label="会話履歴">
          <div className="conversation-history-heading">
            <h2>会話履歴</h2>
            <span>{conversations.length}件</span>
          </div>
          {loadingHistory && <p className="history-status">読み込み中…</p>}
          {!loadingHistory && !conversations.length && (
            <p className="history-status">保存された会話はありません。</p>
          )}
          <div className="conversation-list">
            {conversations.map((item) => (
              <div
                className={conversationId === item.conversationId ? "conversation-item active" : "conversation-item"}
                key={item.conversationId}
              >
                <button
                  className="conversation-open"
                  type="button"
                  onClick={() => void openConversation(item.conversationId)}
                  disabled={busy || !!loadingConversationId || !!deletingConversationId}
                  aria-current={conversationId === item.conversationId ? "true" : undefined}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {historyDateFormatter.format(new Date(item.updatedAt))} ・ {item.messageCount}件
                  </span>
                </button>
                <button
                  className="conversation-delete"
                  type="button"
                  onClick={() => void removeConversation(item)}
                  disabled={busy || !!loadingConversationId || !!deletingConversationId}
                  aria-label={`会話「${item.title}」を削除`}
                >
                  {deletingConversationId === item.conversationId ? "…" : "削除"}
                </button>
              </div>
            ))}
          </div>
        </aside>

        <div className="chat-current" aria-busy={!!loadingConversationId}>
          <div className="message-list" aria-live="polite">
            {loadingConversationId && (
              <div className="message assistant loading">会話を読み込んでいます…</div>
            )}
            {!loadingConversationId && !messages.length && (
              <div className="empty-state compact">
                <div className="empty-icon">?</div>
                <h2>何を調べますか？</h2>
                <p>例：入社時に必要な手続きをチェックリストにして</p>
              </div>
            )}
            {!loadingConversationId && messages.map((message, index) => (
              <article className={`message ${message.role}`} key={index}>
                <div className="message-role">{message.role === "user" ? "あなた" : "ローカルAI"}</div>
                {message.outcome === "insufficient" && (
                  <div className="message-status insufficient">登録情報不足（エラーではありません）</div>
                )}
                <div className="message-content">{messageContent(message, index)}</div>
                {!!message.citations?.length && (
                  <details className="citations">
                    <summary>本文に対応する出典QA（{message.citations.length}件）</summary>
                    {message.citations.map((source) => (
                      <div
                        className="source-card"
                        id={citationTargetId(index, source.markers[0])}
                        key={source.qaId}
                        tabIndex={-1}
                      >
                        <span className="source-marker">{source.markers.join(" ")}</span>
                        <strong>{source.question}</strong>
                        <p>{source.answer}</p>
                      </div>
                    ))}
                  </details>
                )}
              </article>
            ))}
            {busy && <div className="message assistant loading">登録情報を検索して回答を確認しています…</div>}
          </div>
          {error && <p className="error-banner" role="alert"><strong>処理エラー：</strong>{error}</p>}
          <form className="composer" onSubmit={submit}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="業務上の質問や、表・リストへの整理を依頼できます"
              maxLength={4000}
              rows={3}
              disabled={busy || !!loadingConversationId}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button className="primary" type="submit" disabled={busy || !!loadingConversationId || !question.trim()}>送信</button>
          </form>
          <p className="fine-print">AIは登録済みQAにない情報を補いません。重要な判断では出典を確認してください。</p>
        </div>
      </div>
    </div>
  );
}
