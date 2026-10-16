/** Base URL for links we hand out. AUTH_URL is authoritative in production. */
export function appOrigin(request: Request): string {
  const configured = process.env.AUTH_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}
