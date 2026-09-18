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

export function ChatPanel() {
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("local-ai-conversation");
    if (!stored) return;
    const task = window.setTimeout(async () => {
      try {
        const result = await api<{ messages: Message[] }>(`/api/chat?conversationId=${encodeURIComponent(stored)}`);
        setConversationId(stored);
        setMessages(result.messages);
      } catch {
        window.localStorage.removeItem("local-ai-conversation");
      }
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

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
          <p>回答の各内容には、参照したQAが表示されます。</p>
        </div>
        <button className="secondary" onClick={reset} disabled={!messages.length}>新しい会話</button>
      </div>
      <div className="message-list" aria-live="polite">
        {!messages.length && (
          <div className="empty-state compact">
            <div className="empty-icon">?</div>
            <h2>何を調べますか？</h2>
            <p>例：入社時に必要な手続きをチェックリストにして</p>
          </div>
        )}
        {messages.map((message, index) => (
          <article className={`message ${message.role}`} key={index}>
            <div className="message-role">{message.role === "user" ? "あなた" : "ローカルAI"}</div>
            {message.outcome === "insufficient" && (
              <div className="message-status insufficient">登録情報不足（エラーではありません）</div>
            )}
            <div className="message-content">{message.content}</div>
            {!!message.citations?.length && (
              <details className="citations">
                <summary>出典QAを確認（{message.citations.length}件）</summary>
                {message.citations.map((source) => (
                  <div className="source-card" key={source.qaId}>
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
          disabled={busy}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button className="primary" type="submit" disabled={busy || !question.trim()}>送信</button>
      </form>
      <p className="fine-print">AIは登録済みQAにない情報を補いません。重要な判断では出典を確認してください。</p>
    </div>
  );
}
