import { getScope } from "@/lib/scope";
import { listResources, createResource } from "@/lib/data";
import { json, unauthorized, forbidden, badRequest } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everyone signed in can read the library; only coaches can add to it. */
export async function GET() {
  const scope = await getScope();
  if (!scope) return unauthorized();
  return json(await listResources());
}

export async function POST(request: Request) {
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (scope.role !== "coach") return forbidden();

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return badRequest("Give it a title");

  return json(
    await createResource({
      title,
      category: typeof body?.category === "string" ? body.category : "",
      body: typeof body?.body === "string" ? body.body : "",
      link: typeof body?.link === "string" ? body.link : null,
    }),
    201,
  );
}
