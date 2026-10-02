import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSION_LEVEL_IDS } from "./constants";
import { formatQaCsv, parseQaCsv, QaCsvError, QA_CSV_MAX_ROWS, type QaCsvPermissionLevel } from "./qa-csv";
import type { QaRecord } from "./types";

const levels: QaCsvPermissionLevel[] = [
  { id: PERMISSION_LEVEL_IDS.unset, name: "未設定", rank: 0 },
  { id: PERMISSION_LEVEL_IDS.engineer, name: "エンジニア", rank: 1 },
  { id: PERMISSION_LEVEL_IDS.backoffice, name: "バックオフィス", rank: 2 },
];
const record: QaRecord = {
  id: "551ddaba-8056-40f5-aee2-bfd0ad4912d7",
  content_revision: 3,
  question: '申請先は"どこ"ですか？',
  answer: "総務です。\n二階の窓口へ。",
  category: "手続き,社内",
  tags: ["申請", "総務"],
  required_permission_level_id: PERMISSION_LEVEL_IDS.engineer,
  status: "excluded",
  embedding_status: "ready",
  updated_by: "test",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const parse = (source: string) => parseQaCsv(source, levels, 2);

describe("QA CSV", () => {
  it("round trips content with human readable headers and permission names", () => {
    const csv = formatQaCsv([record], levels);
    assert.equal(csv.split("\r\n")[0], "\uFEFF質問,回答,カテゴリ,タグ,公開範囲");
    assert.equal(csv.includes(record.id), false);
    assert.equal(csv.includes(record.required_permission_level_id), false);
    assert.equal(csv.includes("content_revision"), false);
    assert.equal(csv.includes("status"), false);
    assert.deepEqual(parse(csv), [{
      line: 2,
      question: record.question,
      answer: record.answer,
      category: record.category,
      tags: record.tags,
      requiredPermissionLevelId: PERMISSION_LEVEL_IDS.engineer,
    }]);
  });

  it("outputs plain tags without JSON brackets or quotes", () => {
    const csv = formatQaCsv([{ ...record, question: "質問", answer: "回答", category: null }], levels);
    assert.equal(csv.split("\r\n")[1], "質問,回答,,申請、総務,エンジニア");
    assert.deepEqual(parse('質問,回答,タグ,公開範囲\n質問,回答," 申請, 総務,申請 ",バックオフィス')[0].tags, ["申請", "総務"]);
    assert.deepEqual(parse("質問,回答,タグ,公開範囲\n質問,回答,申請、総務,バックオフィス")[0].tags, ["申請", "総務"]);
  });

  it("uses actual DB names and rejects unknown, blank or disallowed names", () => {
    const renamed = levels.map((level) => level.rank === 1 ? { ...level, name: "開発部" } : level);
    assert.match(formatQaCsv([record], renamed), /開発部/);
    assert.equal(parseQaCsv("質問,回答,公開範囲\nA,B,開発部", renamed, 2)[0].requiredPermissionLevelId, PERMISSION_LEVEL_IDS.engineer);
    assert.throws(() => parse("質問,回答,公開範囲\nA,B,不存在"), /2行目.*DBに登録/);
    assert.throws(() => parse("質問,回答,公開範囲\nA,B,"), /DBに登録/);
    assert.throws(() => parse("質問,回答,公開範囲\nA,B,未設定"), /指定できません/);
    assert.throws(() => parseQaCsv("質問,回答,公開範囲\nA,B,バックオフィス", levels, 1), /指定できません/);
  });

  it("accepts English content aliases while requiring the named visibility column", () => {
    const [row] = parse("question,answer,公開範囲\r\n質問,回答,バックオフィス\r\n");
    assert.equal(row.question, "質問");
    assert.equal(row.category, "");
    assert.deepEqual(row.tags, []);
    assert.throws(() => parse("question,answer\nA,B"), /公開範囲/);
  });

  it("keeps formula-like text safe and reversible", () => {
    const item = { ...record, question: '=HYPERLINK("https://example.com")', answer: "'@name", category: "-internal", tags: ["=tag"] };
    const csv = formatQaCsv([item], levels);
    assert.match(csv, /"'=HYPERLINK/);
    const [row] = parse(csv);
    assert.equal(row.question, item.question);
    assert.equal(row.answer, item.answer);
    assert.equal(row.category, item.category);
    assert.deepEqual(row.tags, item.tags);
  });

  it("rejects internal fields, malformed quotes and wrong column counts", () => {
    for (const field of ["id", "content_revision", "status", "required_permission_level_id"]) {
      assert.throws(() => parse(`質問,回答,公開範囲,${field}\nA,B,バックオフィス,x`), /不明な列/);
    }
    assert.throws(() => parse('質問,回答,公開範囲\n"未完了,回答,バックオフィス'), QaCsvError);
    assert.throws(() => parse("質問,回答,公開範囲\n質問,回答,バックオフィス,余り"), /2行目/);
    assert.throws(() => parse("質問,question,回答,公開範囲\nA,B,C,バックオフィス"), /見出し/);
  });

  it("rejects an invalid later row, empty imports and excessive row counts", () => {
    assert.throws(() => parse("質問,回答,公開範囲\nA,B,バックオフィス\nC,D,不存在"), /3行目/);
    assert.throws(() => parse("質問,回答,公開範囲\n"), /インポートするQAがありません/);
    assert.throws(() => parse(`質問,回答,公開範囲\n${"A,B,バックオフィス\n".repeat(QA_CSV_MAX_ROWS + 1)}`), /100件/);
    assert.throws(() => formatQaCsv([record], []), /権限名/);
  });
});
