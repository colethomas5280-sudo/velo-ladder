export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}
export const ok = (data: unknown = { ok: true }) => json(data, 200);
export const unauthorized = () => json({ error: "Sign in required" }, 401);
export const forbidden = () => json({ error: "Not allowed" }, 403);
export const notFound = (msg = "Not found") => json({ error: msg }, 404);
export const badRequest = (msg: string) => json({ error: msg }, 400);
export const serverError = (msg = "Something went wrong") =>
  json({ error: msg }, 500);

/**
 * Run a route handler so a thrown error comes back as JSON rather than a bare
 * 500 with an empty body. Next.js turns an uncaught throw into a response the
 * client can't read, which reaches the UI as a blank message and looks like
 * nothing happened at all.
 *
 * The detail is included on purpose: this is a small private tool, and a coach
 * debugging it alone needs the real reason ("relation ... does not exist")
 * rather than a shrug.
 */
export async function guard(
  fn: () => Promise<Response>,
  label: string,
): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[${label}]`, err);
    return serverError(`${label}: ${detail}`);
  }
}
