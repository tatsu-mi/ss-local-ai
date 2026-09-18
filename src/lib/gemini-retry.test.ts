import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRetryableGeminiError, retryGeminiOperation } from "./gemini-retry";

describe("Gemini transient error retry", () => {
  it("retries transient failures with exponential delays", async () => {
    let calls = 0;
    const delays: number[] = [];
    const attempts: number[] = [];

    const result = await retryGeminiOperation(
      async (attempt) => {
        attempts.push(attempt);
        calls += 1;
        if (calls < 3) throw { status: 503 };
        return "ok";
      },
      {
        maxAttempts: 3,
        baseDelayMs: 100,
        random: () => 0,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    assert.equal(result, "ok");
    assert.equal(calls, 3);
    assert.deepEqual(attempts, [1, 2, 3]);
    assert.deepEqual(delays, [100, 200]);
  });

  it("does not retry non-transient failures", async () => {
    const error = { status: 400 };
    let calls = 0;

    await assert.rejects(
      retryGeminiOperation(
        async () => {
          calls += 1;
          throw error;
        },
        { maxAttempts: 3, baseDelayMs: 0 },
      ),
      (caught) => caught === error,
    );
    assert.equal(calls, 1);
  });

  it("returns the final transient failure after all attempts", async () => {
    const error = { status: 429 };
    let calls = 0;

    await assert.rejects(
      retryGeminiOperation(
        async () => {
          calls += 1;
          throw error;
        },
        { maxAttempts: 3, baseDelayMs: 0 },
      ),
      (caught) => caught === error,
    );
    assert.equal(calls, 3);
    assert.equal(isRetryableGeminiError(error), true);
  });

  it("retries all server errors and nested network failures", () => {
    assert.equal(isRetryableGeminiError({ status: 500 }), true);
    assert.equal(isRetryableGeminiError({ status: "503" }), true);
    assert.equal(
      isRetryableGeminiError({ cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }),
      true,
    );
    assert.equal(isRetryableGeminiError({ name: "APIConnectionError" }), true);
    assert.equal(isRetryableGeminiError({ status: 403 }), false);
  });

  it("adds jitter and caps the delay", async () => {
    const delays: number[] = [];
    let calls = 0;

    await retryGeminiOperation(
      async () => {
        calls += 1;
        if (calls < 3) throw { status: 503 };
        return "ok";
      },
      {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 150,
        random: () => 1,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    assert.deepEqual(delays, [125, 150]);
  });

  it("supports a caller-defined retryable result error", async () => {
    const malformed = new Error("malformed response");
    let calls = 0;

    const result = await retryGeminiOperation(
      async () => {
        calls += 1;
        if (calls === 1) throw malformed;
        return "ok";
      },
      {
        maxAttempts: 2,
        baseDelayMs: 0,
        shouldRetry: (error) => error === malformed,
      },
    );

    assert.equal(result, "ok");
    assert.equal(calls, 2);
  });
});
