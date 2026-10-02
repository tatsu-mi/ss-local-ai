import { ZodError } from "zod";
import type { QaRecord } from "./types";
import { normalizeTags, qaContentSchema } from "./validation";

export const QA_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const QA_CSV_MAX_ROWS = 100;
export const QA_CSV_HEADERS = ["質問", "回答", "カテゴリ", "タグ", "公開範囲"] as const;
export type QaCsvImportMode = "append" | "replace";
export interface QaCsvPermissionLevel { id: string; name: string; rank: number }
export interface QaCsvRow {
  line: number;
  question: string;
  answer: string;
  category: string;
  tags: string[];
  requiredPermissionLevelId: string;
}
export class QaCsvError extends Error {}

const headerAliases: Record<string, string> = {
  question: "質問", answer: "回答", category: "カテゴリ", tags: "タグ",
};

export function parseQaCsv(source: string, levels: QaCsvPermissionLevel[], userRank: number): QaCsvRow[] {
  const records = parseCsvRecords(source.replace(/^\uFEFF/, ""));
  if (!records.length) throw new QaCsvError("CSVが空です。");
  const headers = records[0].fields.map((field) => {
    const header = field.trim();
    return headerAliases[header] ?? header;
  });
  if (new Set(headers).size !== headers.length || headers.some((header) => !QA_CSV_HEADERS.includes(header as typeof QA_CSV_HEADERS[number]))) {
    throw new QaCsvError("CSVの見出しに重複または不明な列があります。");
  }
  if (["質問", "回答", "公開範囲"].some((header) => !headers.includes(header))) {
    throw new QaCsvError("CSVには質問・回答・公開範囲の列が必要です。");
  }

  const rows: QaCsvRow[] = [];
  for (const record of records.slice(1)) {
    if (record.fields.every((field) => !field.trim())) continue;
    if (record.fields.length !== headers.length) throw new QaCsvError(`${record.line}行目の列数が見出しと一致しません。`);
    const fields = Object.fromEntries(headers.map((header, index) => [header, record.fields[index]]));
    try {
      const name = restoreSpreadsheetText(fields["公開範囲"]).trim();
      const matches = levels.filter((level) => level.name === name);
      if (matches.length === 0) throw new Error(`公開範囲「${name}」はDBに登録されていません。`);
      if (matches.length !== 1) throw new Error(`公開範囲「${name}」を一意に特定できません。`);
      const level = matches[0];
      if (level.rank < 1 || level.rank > userRank) throw new Error(`公開範囲「${name}」は指定できません。`);
      const content = qaContentSchema.parse({
        question: restoreSpreadsheetText(fields["質問"]),
        answer: restoreSpreadsheetText(fields["回答"]),
        category: restoreSpreadsheetText(fields["カテゴリ"] ?? ""),
        tags: normalizeTags(restoreSpreadsheetText(fields["タグ"] ?? "").split(/[,、]/)),
      });
      rows.push({ line: record.line, ...content, requiredPermissionLevelId: level.id });
    } catch (error) {
      const message = error instanceof ZodError ? error.issues[0]?.message
        : error instanceof Error ? error.message : "入力を確認してください。";
      throw new QaCsvError(`${record.line}行目: ${message}`);
    }
    if (rows.length > QA_CSV_MAX_ROWS) throw new QaCsvError(`一度にインポートできるQAは${QA_CSV_MAX_ROWS}件までです。`);
  }
  if (!rows.length) throw new QaCsvError("インポートするQAがありません。");
  return rows;
}

export function formatQaCsv(items: QaRecord[], levels: QaCsvPermissionLevel[]): string {
  const names = new Map(levels.map((level) => [level.id, level.name]));
  const records = items.map((item) => {
    const name = names.get(item.required_permission_level_id);
    if (name === undefined) throw new QaCsvError("QAの公開範囲に対応する権限名がDBにありません。");
    return [item.question, item.answer, item.category ?? "", item.tags.join("、"), name];
  });
  return `\uFEFF${[QA_CSV_HEADERS, ...records].map((fields) => fields.map(escapeCsvField).join(",")).join("\r\n")}\r\n`;
}

function escapeCsvField(value: string): string {
  // Keep spreadsheet apps from treating QA text as a formula.
  const safe = /^'*[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function restoreSpreadsheetText(value: string): string {
  return value.startsWith("'") && /^'*[\s\uFEFF]*[=+\-@]/.test(value.slice(1)) ? value.slice(1) : value;
}

function parseCsvRecords(source: string): { line: number; fields: string[] }[] {
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let line = 1;
  let rowLine = 1;
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else { field += char; if (char === "\n") line++; }
    } else if (char === '"' && !field && !closedQuote) {
      quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      fields.push(field);
      field = "";
      closedQuote = false;
      if (char !== ",") {
        if (char === "\r" && source[index + 1] === "\n") index++;
        records.push({ line: rowLine, fields });
        fields = [];
        line++;
        rowLine = line;
      }
    } else if (closedQuote || char === '"') {
      throw new QaCsvError(`${line}行目の引用符の形式が正しくありません。`);
    } else {
      field += char;
    }
  }
  if (quoted) throw new QaCsvError(`${rowLine}行目の引用符が閉じていません。`);
  if (field || fields.length || closedQuote) records.push({ line: rowLine, fields: [...fields, field] });
  return records;
}
