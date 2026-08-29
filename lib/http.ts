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
