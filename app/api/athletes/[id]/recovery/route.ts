import { getScope, canSeeAthlete } from "@/lib/scope";
import {
  listRecovery,
  upsertRecovery,
  deleteRecovery,
  reconcileSetbacks,
} from "@/lib/data";
import type { ArmStatus } from "@/lib/types";
import { PROFILE_FIELDS } from "@/lib/profile";
import { todayISO } from "@/lib/velo";
import { json, unauthorized, forbidden, badRequest, guard } from "@/lib/http";

// The profile and the check-in both write `athletes.weight_lb`; they must
// agree on what a valid weight is, or a check-in stores a number the profile
// form would refuse.
const WEIGHT = PROFILE_FIELDS.find((f) => f.key === "weightLb")!;
const WEIGHT_MIN = WEIGHT.min ?? 0;
const WEIGHT_MAX = WEIGHT.max ?? Number.POSITIVE_INFINITY;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rating = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};
/** For questions whose scale isn't 1-5. */
const scaled = (v: unknown, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
};
const positive = (v: unknown, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) && n > 0 && n <= max ? n : null;
};
const inRange = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) && n >= min && n <= max ? n : null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope();
  if (!scope) return unauthorized();
  if (!canSeeAthlete(scope, id)) return forbidden();
  return guard(
    async () => json(await listRecovery(id)),
    "Loading check-ins failed",
  );
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
  // A future date is a typo. Left in, one mistyped year sets `weight_at` far
  // ahead and the `weight_at <= date` guard then blocks every real check-in
  // after it.
  if (date > todayISO()) return badRequest("date can't be in the future");

  const entry = {
    date,
    sleepHours: positive(b.sleepHours, 24),
    sleepQuality: rating(b.sleepQuality),
    soreness: rating(b.soreness),
    energy: rating(b.energy),
    stress: rating(b.stress),
    mood: rating(b.mood),
    diet: rating(b.diet),
    armReadiness: scaled(b.armReadiness, 5),
    bodyWeight: inRange(b.bodyWeight, WEIGHT_MIN, WEIGHT_MAX),
    sleepDuration: rating(b.sleepDuration),
    restingHr: positive(b.restingHr, 200),
    armStatus: (["good", "sore", "pain"] as const).includes(
      b.armStatus as ArmStatus,
    )
      ? (b.armStatus as ArmStatus)
      : null,
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
    entry.diet != null ||
    entry.armReadiness != null ||
    entry.bodyWeight != null ||
    entry.sleepDuration != null ||
    entry.restingHr != null ||
    entry.hrv != null ||
    entry.armStatus != null ||
    entry.notes.trim() !== "";
  if (!anything) return badRequest("Fill in at least one field");

  return guard(async () => {
    const saved = await upsertRecovery(id, entry, scope.email);
    // Re-evaluate the setback branches against the new data.
    await reconcileSetbacks(id);
    return json(saved, 201);
  }, "Saving the check-in failed");
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
  await reconcileSetbacks(id);
  return json({ ok: true });
}
