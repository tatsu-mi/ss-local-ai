import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCitationMarkers } from "./citation-markers";

test("renumbers cited sources from S1 in their first-use order", () => {
  const result = normalizeCitationMarkers(
    "先に二つ目を参照します。[S4] 次に一つ目です。[S2] また二つ目です。[S4]",
    [
      { qaId: "qa-1", markers: ["[S2]"] },
      { qaId: "qa-2", markers: ["[S4]"] },
      { qaId: "qa-3", markers: [] },
    ],
  );

  assert.equal(
    result.content,
    "先に二つ目を参照します。[S1] 次に一つ目です。[S2] また二つ目です。[S1]",
  );
  assert.deepEqual(result.citations, [
    { qaId: "qa-2", markers: ["[S1]"] },
    { qaId: "qa-1", markers: ["[S2]"] },
    { qaId: "qa-3", markers: [] },
  ]);
});

test("uses one marker and one source entry when a QA has multiple old markers", () => {
  const result = normalizeCitationMarkers(
    "同じ出典です。[S2] 補足も同じ出典です。[S5]",
    [{ qaId: "qa-1", markers: ["[S2]", "[S5]"] }],
  );

  assert.equal(result.content, "同じ出典です。[S1] 補足も同じ出典です。[S1]");
  assert.deepEqual(result.citations, [{ qaId: "qa-1", markers: ["[S1]"] }]);
});

test("adds sequential markers when declared citations are missing from the answer", () => {
  const result = normalizeCitationMarkers(
    "本文に番号がありません。",
    [
      { qaId: "qa-1", markers: ["[S3]"] },
      { qaId: "qa-2", markers: ["[S5]"] },
    ],
  );

  assert.equal(result.content, "本文に番号がありません。\n\n出典: [S1] [S2]");
  assert.deepEqual(result.citations, [
    { qaId: "qa-1", markers: ["[S1]"] },
    { qaId: "qa-2", markers: ["[S2]"] },
  ]);
});

test("removes an inline marker that has no matching source", () => {
  const result = normalizeCitationMarkers(
    "確認済みです。[S2] 不明な番号です。[S9]",
    [{ qaId: "qa-1", markers: ["[S2]"] }],
  );

  assert.equal(result.content, "確認済みです。[S1] 不明な番号です。");
  assert.deepEqual(result.citations, [{ qaId: "qa-1", markers: ["[S1]"] }]);
});
