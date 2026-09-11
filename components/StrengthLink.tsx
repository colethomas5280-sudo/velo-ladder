"use client";

import Link from "next/link";
import useSWR from "swr";
import type { LiftSession } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import { liftMenu, liftsEverDone, type Lift } from "@/lib/strength";
import { fmtDate } from "@/lib/velo";

/**
 * What the lifting log leaves behind on the profile.
 *
 * The log lives under Strength, but a tracker page that says nothing about it
 * invites the reading that this athlete does not lift. One line, and a way
 * through — the same job `ScreenLink` does for the movement screen.
 */
export default function StrengthLink({ athleteId }: { athleteId: string }) {
  const { data } = useSWR<LiftSession[]>(
    `/api/athletes/${athleteId}/lifts`,
    fetcher,
  );
  const { data: liftRows } = useSWR<Lift[]>("/api/lifts", fetcher);
  const days = data ?? [];
  const last = days.length ? days[days.length - 1] : null;
  const lifts = liftsEverDone(liftMenu(liftRows ?? []), days).length;

  return (
    <Link href={`/strength/${athleteId}`} className="card pad screen-link">
      <div>
        <div className="eyebrow">Lifting</div>
        <b>
          {last
            ? `${days.length} session${days.length === 1 ? "" : "s"} · ${lifts} lift${lifts === 1 ? "" : "s"}`
            : "Nothing logged yet"}
        </b>
        {last && <span className="cz-note">Last lifted {fmtDate(last.date)}</span>}
      </div>
      <span className="sl-go">Open lifting →</span>
    </Link>
  );
}
