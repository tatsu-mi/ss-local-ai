const RETRYABLE_GEMINI_STATUSES = new Set([408, 429]);
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const RETRYABLE_ERROR_NAMES = new Set([
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "TimeoutError",
]);

export interface RetryableGeminiError {
  status?: number;
}

export function isRetryableGeminiError(error: unknown): error is RetryableGeminiError {
  return isRetryable(error, new Set());
}

function isRetryable(error: unknown, seen: Set<object>): boolean {
  if (typeof error !== "object" || error === null || seen.has(error)) return false;
  seen.add(error);

  const candidate = error as {
    status?: unknown;
    code?: unknown;
    name?: unknown;
    cause?: unknown;
  };
  const status = numericStatus(candidate.status);
  if (
    status !== undefined &&
    (RETRYABLE_GEMINI_STATUSES.has(status) || (status >= 500 && status <= 599))
  ) {
    return true;
  }
  if (typeof candidate.code === "string" && RETRYABLE_NETWORK_CODES.has(candidate.code)) {
    return true;
  }
  if (typeof candidate.name === "string" && RETRYABLE_ERROR_NAMES.has(candidate.name)) {
    return true;
  }
  return isRetryable(candidate.cause, seen);
}

function numericStatus(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  return undefined;
}

export async function retryGeminiOperation<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs?: number;
    onRetry?: (details: {
      error: unknown;
      attempt: number;
      maxAttempts: number;
      delayMs: number;
    }) => void;
    shouldRetry?: (error: unknown) => boolean;
    sleep?: (delayMs: number) => Promise<void>;
    random?: () => number;
  },
): Promise<T> {
  const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const random = options.random ?? Math.random;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const shouldRetry = options.shouldRetry ?? isRetryableGeminiError;
      if (!shouldRetry(error) || attempt >= options.maxAttempts) throw error;

      const exponentialDelay = options.baseDelayMs * 2 ** (attempt - 1);
      const jitteredDelay = Math.round(exponentialDelay * (1 + random() * 0.25));
      const delayMs = Math.min(options.maxDelayMs ?? Number.POSITIVE_INFINITY, jitteredDelay);
      options.onRetry?.({ error, attempt, maxAttempts: options.maxAttempts, delayMs });
      await sleep(delayMs);
    }
  }
}
