"use client";

import { DragEvent, FormEvent, useId, useRef, useState } from "react";
import { PERMISSION_LEVEL_IDS } from "@/lib/constants";
import { api, jsonRequest } from "./api";

interface DraftQa {
  id: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
  selected: boolean;
  access: string;
  state: "draft" | "saving" | "ready" | "saved_failed" | "failed";
  error?: string;
}

export function PdfPanel() {
  const fileInputId = useId();
  const dragDepth = useRef(0);
  const [file, setFile] = useState<File>();
  const [isDragging, setIsDragging] = useState(false);
  const [items, setItems] = useState<DraftQa[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function selectFile(selectedFile?: File) {
    if (!selectedFile) return;
    if (selectedFile.type !== "application/pdf") {
      setFile(undefined);
      setError("PDFファイルを選択してください。");
      return;
    }
    setFile(selectedFile);
    setError("");
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  async function extract(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError(""); setItems([]);
    try {
      const form = new FormData(); form.set("file", file);
      const result = await api<{ items: Array<Omit<DraftQa, "selected" | "access" | "state">> }>("/api/pdf/extract", { method: "POST", body: form });
      setItems(result.items.map((item) => ({ ...item, id: crypto.randomUUID(), selected: true, access: PERMISSION_LEVEL_IDS.backoffice, state: "draft" })));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "抽出に失敗しました。"); }
    finally { setBusy(false); }
  }

  function update(index: number, values: Partial<DraftQa>) {
    setItems((current) => current.map((item, at) => at === index ? { ...item, ...values } : item));
  }

  async function registerSelected() {
    setBusy(true); setError("");
    const pending = items.map((item, index) => ({ item, index })).filter(({ item }) => item.selected && item.state !== "ready" && item.state !== "saved_failed");
    for (const { item, index } of pending) {
      update(index, { state: "saving", error: undefined });
      try {
        const result = await api<{ item: { embedding_status: "ready" | "pending" | "failed" } }>("/api/qa", jsonRequest("POST", { id: item.id, question: item.question, answer: item.answer, category: item.category, tags: item.tags, requiredPermissionLevelId: item.access }));
        update(index, { state: result.item.embedding_status === "ready" ? "ready" : "saved_failed", error: result.item.embedding_status === "failed" ? "本文は保存されましたが検索準備に失敗しました。QA一覧から再試行できます。" : result.item.embedding_status === "pending" ? "本文は保存済みです。QA一覧から検索準備を再試行できます。" : undefined });
      } catch (caught) {
        update(index, { state: "failed", error: caught instanceof Error ? caught.message : "登録に失敗しました。" });
      }
    }
    setBusy(false);
  }

  return (
    <div className="panel">
      <div className="panel-heading"><div><p className="eyebrow">PDF TO QA</p><h1>PDFからQAを入力</h1><p>抽出結果はここで編集し、選択した項目だけを登録します。</p></div></div>
      <form className="upload-card" onSubmit={extract}>
        <div
          className={`pdf-drop-zone${isDragging ? " is-dragging" : ""}`}
          onDragEnter={handleDragEnter}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            id={fileInputId}
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
          <label htmlFor={fileInputId}>
            <span className="pdf-drop-icon" aria-hidden="true">PDF</span>
            <strong>{file ? file.name : "PDFをドラッグ＆ドロップ"}</strong>
            <span>{file ? "別のPDFに変更するには、ここをクリックするかドロップしてください" : "またはクリックしてファイルを選択"}</span>
          </label>
        </div>
        <button className="primary" disabled={!file || busy}>{busy && !items.length ? "抽出中…" : "QA候補を抽出"}</button>
        <p className="fine-print">PDF本体・ファイル名・ページ情報はDBに保存しません。</p>
      </form>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {!!items.length && <div className="draft-list">
        <div className="section-heading"><h2>抽出したQA候補</h2><button className="primary" disabled={busy || !items.some((item) => item.selected && item.state !== "ready" && item.state !== "saved_failed")} onClick={() => void registerSelected()}>選択項目を登録</button></div>
        {items.map((item, index) => <article className="editor-card" key={index}>
          <div className="selection-row"><label><input type="checkbox" checked={item.selected} disabled={item.state === "ready" || item.state === "saved_failed"} onChange={(e) => update(index, { selected: e.target.checked })} /> 登録する</label><span className={`status status-${item.state}`}>{item.state === "ready" ? "登録・検索準備済み" : item.state === "saved_failed" ? "登録済み・検索準備失敗" : item.state === "saving" ? "登録中" : item.state === "failed" ? "要確認" : "未登録"}</span></div>
          <label>質問<input value={item.question} disabled={item.state === "ready" || item.state === "saved_failed"} onChange={(e) => update(index, { question: e.target.value })} /></label>
          <label>回答<textarea rows={4} value={item.answer} disabled={item.state === "ready" || item.state === "saved_failed"} onChange={(e) => update(index, { answer: e.target.value })} /></label>
          <div className="form-grid"><label>カテゴリ<input value={item.category} disabled={item.state === "ready" || item.state === "saved_failed"} onChange={(e) => update(index, { category: e.target.value })} /></label><label>タグ（カンマ区切り）<input value={item.tags.join(", ")} disabled={item.state === "ready" || item.state === "saved_failed"} onChange={(e) => update(index, { tags: e.target.value.split(/[,、]/).map((tag) => tag.trim()).filter(Boolean) })} /></label><label>公開範囲<select value={item.access} disabled={item.state === "ready" || item.state === "saved_failed"} onChange={(e) => update(index, { access: e.target.value })}><option value={PERMISSION_LEVEL_IDS.backoffice}>バックオフィスのみ</option><option value={PERMISSION_LEVEL_IDS.engineer}>エンジニアにも公開</option></select></label></div>
          {item.error && <p className="error-text">{item.error}</p>}
        </article>)}
      </div>}
    </div>
  );
}
