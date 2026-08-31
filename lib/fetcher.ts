export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/**
 * Turn a failed response into a message that is never empty.
 *
 * `r.statusText` is "" on every HTTP/2 response — which is what production
 * serves — while local dev over HTTP/1.1 fills it in. Trusting it therefore
 * produces an error that is invisible in production and perfectly visible in
 * testing: an empty string is falsy, so `{err && <p/>}` renders nothing and the
 * UI looks like the button did nothing at all. Always end with a real string.
 */
async function failure(r: Response): Promise<ApiError> {
  const body = (await r.json().catch(() => ({}))) as { error?: unknown };
  const detail =
    typeof body.error === "string" && body.error.trim() ? body.error.trim() : "";
  if (detail) return new ApiError(r.status, detail);
  const text = r.statusText.trim();
  return new ApiError(r.status, text ? `${text} (${r.status})` : `Request failed (${r.status})`);
}

export async function fetcher<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw await failure(r);
  return r.json();
}

export async function api<T = unknown>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw await failure(r);
  return r.json().catch(() => ({}) as T);
}
