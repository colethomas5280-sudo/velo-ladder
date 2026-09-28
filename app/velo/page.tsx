import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { veloSnapshotDate } from "@/lib/veloSeed";
import AppHeader from "@/components/AppHeader";
import VeloLadder from "@/components/VeloLadder";

/* ------------------------------------------------------------------ *
 * The velo ladder page
 *
 * A thin server shell, same shape as app/tests/page.tsx. The snapshot date
 * lives in lib/veloSeed.ts, which is server-only (it reads the seed JSON off
 * disk), so it is resolved here and passed down as a plain string prop
 * rather than imported anywhere under components/.
 * ------------------------------------------------------------------ */

export const dynamic = "force-dynamic";

export default async function VeloPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <VeloLadder snapshotDate={veloSnapshotDate()} />
    </div>
  );
}
