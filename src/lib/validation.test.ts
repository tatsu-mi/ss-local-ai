import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PERMISSION_GROUP_ID, PERMISSION_LEVEL_IDS } from "./constants";
import {
  createQaSchema,
  embeddingDocument,
  normalizeTags,
  updateQaSchema,
  updateUserSchema,
} from "./validation";

describe("QA validation", () => {
  it("rejects whitespace-only required content", () => {
    assert.throws(() => createQaSchema.parse({ question: "  ", answer: "回答" }));
    assert.throws(() => createQaSchema.parse({ question: "質問", answer: "\n" }));
  });

  it("uses backoffice-only as the default visibility", () => {
    const result = createQaSchema.parse({ question: "質問", answer: "回答" });
    assert.equal(result.requiredPermissionLevelId, PERMISSION_LEVEL_IDS.backoffice);
  });

  it("does not accept an unset level for business QA", () => {
    assert.throws(() =>
      createQaSchema.parse({
        question: "質問",
        answer: "回答",
        requiredPermissionLevelId: PERMISSION_LEVEL_IDS.unset,
      }),
    );
  });

  it("deduplicates and trims tags", () => {
    assert.deepEqual(normalizeTags([" 総務 ", "総務", "", "入社"]), ["総務", "入社"]);
  });

  it("builds a deterministic embedding document", () => {
    assert.equal(
      embeddingDocument({
        question: "申請先は？",
        answer: "総務です。",
        category: "手続き",
        tags: ["申請", "窓口"],
      }),
      "質問: 申請先は？\n回答: 総務です。\nカテゴリ: 手続き\nタグ: 申請, 窓口",
    );
  });

  it("requires optimistic concurrency data for content updates", () => {
    assert.throws(() =>
      updateQaSchema.parse({ kind: "content", question: "質問", answer: "回答" }),
    );
  });

  it("accepts the seeded PostgreSQL permission group UUID", () => {
    assert.deepEqual(updateUserSchema.parse({ permissionGroupId: DEFAULT_PERMISSION_GROUP_ID }), {
      permissionGroupId: DEFAULT_PERMISSION_GROUP_ID,
    });
    assert.throws(() => updateUserSchema.parse({ permissionGroupId: "not-a-uuid" }));
  });
});
