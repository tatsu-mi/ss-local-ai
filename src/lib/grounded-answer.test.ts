import assert from "node:assert/strict";
import test from "node:test";
import {
  INSUFFICIENT_ANSWER,
  parseGroundedAnswerResponse,
} from "./grounded-answer";

const qaId = "11111111-1111-4111-8111-111111111111";

test("accepts a grounded answer with matching citations", () => {
  const result = parseGroundedAnswerResponse(JSON.stringify({
    status: "answered",
    answer: "申請先は総務です。[S1]",
    citations: [{ marker: "[S1]", qaId }],
  }), [qaId]);

  assert.equal(result.status, "answered");
  assert.equal(result.citations.length, 1);
});

test("turns an insufficient result into a safe normal response", () => {
  const result = parseGroundedAnswerResponse(JSON.stringify({
    status: "insufficient",
    answer: "モデルが生成した文言 [S1]",
    citations: [{ marker: "[S1]", qaId }],
  }), [qaId]);

  assert.deepEqual(result, {
    status: "insufficient",
    answer: INSUFFICIENT_ANSWER,
    citations: [],
  });
});

test("rejects an answered result whose citation is absent from the answer", () => {
  assert.throws(
    () => parseGroundedAnswerResponse(JSON.stringify({
      status: "answered",
      answer: "申請先は総務です。",
      citations: [{ marker: "[S1]", qaId }],
    }), [qaId]),
    /citation marker not present/,
  );
});

test("rejects undeclared markers in an answered result", () => {
  assert.throws(
    () => parseGroundedAnswerResponse(JSON.stringify({
      status: "answered",
      answer: "申請先は総務です。[S1] 詳細は未登録です。[S2]",
      citations: [{ marker: "[S1]", qaId }],
    }), [qaId]),
    /undeclared citation marker/,
  );
});
