"use client";

import { DragEvent, FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { PERMISSION_LEVEL_IDS } from "@/lib/constants";
import type { QaRecord } from "@/lib/types";
import { api, jsonRequest } from "./api";

const blank = { question: "", answer: "", category: "", tags: "" };

export function QaPanel({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<QaRecord[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(blank);
  const [access, setAccess] = useState(PERMISSION_LEVEL_IDS.backoffice);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [csvResult, setCsvResult] = useState<ImportResult | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const csvInputId = useId();
  const csvDragDepth = useRef(0);
  const [isDraggingCsv, setIsDraggingCsv] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [csvFile, setCsvFile] = useState<File | null>(null);

  const load = useCallback(async (query = "") => {
    try {
      setError("");
      const result = await api<{ items: QaRecord[] }>(`/api/qa?q=${encodeURIComponent(query)}`);
      setItems(result.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "QAの取得に失敗しました。");
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/qa", jsonRequest("POST", {
        question: draft.question,
        answer: draft.answer,
        category: draft.category,
        tags: splitTags(draft.tags),
        requiredPermissionLevelId: access,
      }));
      setDraft(blank);
      setShowCreate(false);
      await load(search);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登録に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/qa/${id}`, jsonRequest("PATCH", body));
      await load(search);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/qa/csv");
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "CSVのエクスポートに失敗しました。");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `qa-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CSVのエクスポートに失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  function selectCsvFiles(files: FileList | null) {
    if (busy || !files?.length) return;
    const selectedFiles = Array.from(files);
    if (csvInput.current) csvInput.current.value = "";
    setCsvFile(null);
    setCsvResult(null);
    if (selectedFiles.length !== 1) {
      setError("CSVファイルは1つずつ選択してください。");
      return;
    }
    const file = selectedFiles[0];
    if (!/\.csv$/i.test(file.name)) {
      setError("CSVファイルを選択してください。");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("CSVファイルは2MB以下にしてください。");
      return;
    }
    setCsvFile(file);
    setError("");
  }

  function resetCsvSelection() {
    setCsvFile(null);
    if (csvInput.current) csvInput.current.value = "";
    csvDragDepth.current = 0;
    setIsDraggingCsv(false);
  }

  function handleCsvDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (busy || !Array.from(event.dataTransfer.types).includes("Files")) return;
    csvDragDepth.current += 1;
    setIsDraggingCsv(true);
  }

  function handleCsvDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    csvDragDepth.current = Math.max(0, csvDragDepth.current - 1);
    if (csvDragDepth.current === 0) setIsDraggingCsv(false);
  }

  function handleCsvDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    csvDragDepth.current = 0;
    setIsDraggingCsv(false);
    selectCsvFiles(event.dataTransfer.files);
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = csvFile;
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("CSVファイルは2MB以下にしてください。");
      return;
    }
    setBusy(true);
    setError("");
    setCsvResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", importMode);
      const result = await api<ImportResult>("/api/qa/csv", { method: "POST", body: form });
      setCsvResult(result);
      resetCsvSelection();
      setShowImport(false);
      await load(search);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CSVのインポートに失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">KNOWLEDGE</p>
          <h1>QA一覧</h1>
          <p>{canManage ? "本文・公開範囲・検索準備状態を管理します。" : "閲覧可能な登録情報を確認できます。"}</p>
        </div>
        {canManage && <div className="qa-actions">
          <button className="secondary" type="button" disabled={busy} onClick={() => { resetCsvSelection(); setShowImport((value) => !value); }}>CSVインポート</button>
          <button className="secondary" type="button" disabled={busy} onClick={() => void exportCsv()}>CSVエクスポート</button>
          <button className="primary" type="button" disabled={busy} onClick={() => setShowCreate((value) => !value)}>QAを追加</button>
        </div>}
      </div>
      {canManage && showImport && <form className="editor-card" onSubmit={importCsv}>
        <h2>CSVインポート</h2>
        <label>インポート方法<select value={importMode} disabled={busy} onChange={(event) => setImportMode(event.target.value as "append" | "replace")}>
          <option value="append">追加（既存のQAを残す）</option>
          <option value="replace">全置き換え（既存のQAをすべて置き換える）</option>
        </select></label>
        <div
          className={`csv-drop-zone${isDraggingCsv && !busy ? " is-dragging" : ""}${busy ? " is-disabled" : ""}`}
          onDragEnter={handleCsvDragEnter}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; }}
          onDragLeave={handleCsvDragLeave}
          onDrop={handleCsvDrop}
        >
          <input
            ref={csvInput}
            id={csvInputId}
            className="visually-hidden"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(event) => selectCsvFiles(event.target.files)}
          />
          <label htmlFor={csvInputId}>
            <span className="csv-drop-icon" aria-hidden="true">CSV</span>
            <strong aria-live="polite">{csvFile ? csvFile.name : "CSVをドラッグ＆ドロップ"}</strong>
            <span>{csvFile ? "別のCSVに変更するには、ここをクリックするかドロップしてください" : "またはクリックしてファイルを選択（2MBまで）"}</span>
          </label>
        </div>
        {importMode === "replace" && <p className="fine-print">登録済みのQAはすべて削除扱いとなり、CSVの内容が新しいQAとして登録されます。</p>}
        <div className="button-row">
          <button className="primary" disabled={busy || !csvFile}>{busy ? "インポート中…" : importMode === "replace" ? "全置き換えしてインポート" : "追加してインポート"}</button>
          <button className="secondary" type="button" disabled={busy} onClick={() => { resetCsvSelection(); setShowImport(false); }}>キャンセル</button>
        </div>
      </form>}
      <form className="search-row" onSubmit={(event) => { event.preventDefault(); void load(search); }}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="質問・回答をキーワード検索" />
        <button className="secondary" type="submit">検索</button>
      </form>
      {showCreate && (
        <form className="editor-card" onSubmit={create}>
          <h2>新しいQA</h2>
          <label>質問<input required maxLength={2000} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} /></label>
          <label>回答<textarea required maxLength={10000} rows={5} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} /></label>
          <div className="form-grid">
            <label>カテゴリ（任意）<input maxLength={200} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></label>
            <label>タグ（カンマ区切り）<input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} /></label>
            <label>公開範囲<select value={access} onChange={(e) => setAccess(e.target.value as typeof access)}><option value={PERMISSION_LEVEL_IDS.backoffice}>バックオフィスのみ</option><option value={PERMISSION_LEVEL_IDS.engineer}>エンジニアにも公開</option></select></label>
          </div>
          <div className="button-row"><button className="primary" disabled={busy}>保存して検索準備</button><button className="secondary" type="button" onClick={() => setShowCreate(false)}>キャンセル</button></div>
        </form>
      )}
      {canManage && <p className="fine-print">CSVはUTF-8形式。質問・回答・公開範囲の列が必須です。公開範囲はDBの権限名、タグは「、」またはカンマ区切りで指定します。一度に100件・2MBまでインポートできます。</p>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      {csvResult && <div className={csvResult.errors.length ? "error-banner" : "csv-result"} role="status">
        <p>CSVインポート: {csvResult.mode === "replace" ? "全置き換え" : "追加"}で{csvResult.created}件を登録しました。検索準備の失敗 {csvResult.errors.length}件</p>
        {csvResult.errors.length > 0 && <ul>{csvResult.errors.map((item) => <li key={item.line}>{item.line}行目: {item.message}</li>)}</ul>}
      </div>}
      <div className="qa-list">
        {items.map((item) => (
          <QaCard key={item.id} item={item} canManage={canManage} busy={busy} patch={patch} reload={() => load(search)} setError={setError} />
        ))}
        {!items.length && !error && <div className="empty-state compact"><h2>QAがありません</h2><p>検索条件を変えるか、新しいQAを登録してください。</p></div>}
      </div>
    </div>
  );
}

function QaCard({ item, canManage, busy, patch, reload, setError }: {
  item: QaRecord;
  canManage: boolean;
  busy: boolean;
  patch: (id: string, body: unknown) => Promise<void>;
  reload: () => Promise<void>;
  setError: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ question: item.question, answer: item.answer, category: item.category ?? "", tags: item.tags.join(", ") });
  const updater = item.updater as unknown as { display_name?: string } | null;
  return (
    <article className={`qa-card status-${item.status}`}>
      <div className="qa-meta">
        <span className={`status status-${item.embedding_status}`}>{embeddingLabel(item.embedding_status)}</span>
        {item.status !== "active" && <span className="status muted-status">{item.status === "excluded" ? "検索対象外" : "削除済み"}</span>}
        {item.category && <span>{item.category}</span>}
        {item.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}
      </div>
      {editing ? (
        <form onSubmit={(event) => { event.preventDefault(); void patch(item.id, { kind: "content", expectedRevision: item.content_revision, question: draft.question, answer: draft.answer, category: draft.category, tags: splitTags(draft.tags) }).then(() => setEditing(false)); }}>
          <label>質問<input required value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} /></label>
          <label>回答<textarea required rows={5} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} /></label>
          <div className="form-grid"><label>カテゴリ<input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></label><label>タグ<input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} /></label></div>
          <div className="button-row"><button className="primary" disabled={busy}>更新</button><button className="secondary" type="button" onClick={() => setEditing(false)}>キャンセル</button></div>
        </form>
      ) : (
        <><h2>{item.question}</h2><p className="answer-text">{item.answer}</p></>
      )}
      <div className="qa-footer">
        <small>版 {item.content_revision} ・ {new Date(item.updated_at).toLocaleString("ja-JP")} {updater?.display_name && `・ ${updater.display_name}`}</small>
        {canManage && !editing && (
          <div className="button-row wrap">
            <button className="link-button" onClick={() => setEditing(true)}>編集</button>
            <select aria-label="公開範囲" value={item.required_permission_level_id} disabled={busy} onChange={(e) => void patch(item.id, { kind: "access", requiredPermissionLevelId: e.target.value })}><option value={PERMISSION_LEVEL_IDS.backoffice}>バックオフィスのみ</option><option value={PERMISSION_LEVEL_IDS.engineer}>エンジニアにも公開</option></select>
            {item.embedding_status !== "ready" && item.status === "active" && <button className="link-button" onClick={async () => { try { await api(`/api/qa/${item.id}/embedding`, { method: "POST" }); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "再試行に失敗しました。"); } }}>検索準備を再試行</button>}
            <button className="link-button" onClick={() => void patch(item.id, { kind: "status", status: item.status === "active" ? "excluded" : "active" })}>{item.status === "active" ? "検索対象外にする" : "再公開"}</button>
            <button className="link-button danger" onClick={() => { if (window.confirm("このQAを削除しますか？")) void patch(item.id, { kind: "status", status: "deleted" }); }}>削除</button>
          </div>
        )}
      </div>
    </article>
  );
}

function splitTags(value: string) { return value.split(/[,、]/).map((tag) => tag.trim()).filter(Boolean); }
function embeddingLabel(status: QaRecord["embedding_status"]) { return status === "ready" ? "検索準備済み" : status === "pending" ? "検索準備中" : "検索準備失敗"; }

interface ImportResult {
  created: number;
  mode: "append" | "replace";
  errors: { line: number; message: string }[];
}
