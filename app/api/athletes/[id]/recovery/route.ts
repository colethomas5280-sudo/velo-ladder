import { getScope, canSeeAthlete } from "@/lib/scope";
import { listRecovery, upsertRecovery, deleteRecovery } from "@/lib/data";
import { json, unauthorized, forbidden, badRequest } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rating = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};
const positive = (v: unknown, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) && n > 0 && n <= max ? n : null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();
  return json(await listRecovery(id));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const date = String(b.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return badRequest("date must be YYYY-MM-DD");

  const entry = {
    date,
    sleepHours: positive(b.sleepHours, 24),
    sleepQuality: rating(b.sleepQuality),
    soreness: rating(b.soreness),
    energy: rating(b.energy),
    stress: rating(b.stress),
    mood: rating(b.mood),
    restingHr: positive(b.restingHr, 200),
    hrv: positive(b.hrv, 400),
    notes: typeof b.notes === "string" ? b.notes.slice(0, 2000) : "",
  };
  const anything =
    entry.sleepHours != null ||
    entry.sleepQuality != null ||
    entry.soreness != null ||
    entry.energy != null ||
    entry.stress != null ||
    entry.mood != null ||
    entry.restingHr != null ||
    entry.hrv != null ||
    entry.notes.trim() !== "";
  if (!anything) return badRequest("Fill in at least one field");

  return json(await upsertRecovery(id, entry, scope.email), 201);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("date required");
  await deleteRecovery(id, date);
  return json({ ok: true });
}
