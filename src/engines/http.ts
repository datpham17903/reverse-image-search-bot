export class PreSendError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PreSendError";
  }
}

const RETRYABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

function isRetryable(err: unknown): boolean {
  const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" && RETRYABLE_CODES.has(code);
}

export async function sendRequest(f: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await f(url, init);
  } catch (err) {
    if (!isRetryable(err)) throw err;
  }
  try {
    return await f(url, init);
  } catch (err) {
    if (isRetryable(err)) throw new PreSendError("connection failed before request was sent", { cause: err });
    throw err;
  }
}

export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  const name = (err as { name?: string } | null)?.name;
  return signal?.aborted === true || name === "AbortError" || name === "TimeoutError";
}
