"use client";

import Link from "next/link";
import useSWR from "swr";
import type { MovementScreen } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import { screenSummary, standingScreen } from "@/lib/screen";
import { fmtDate } from "@/lib/velo";

/**
 * What the movement screen leaves behind on the profile.
 *
 * The screen itself lives under Tests now, but a profile that says nothing
 * about it invites the reading that this athlete has never been screened.
 * One line, and a way through.
 */
export default function ScreenLink({ athleteId }: { athleteId: string }) {
  const { data } = useSWR<MovementScreen[]>(
    `/api/athletes/${athleteId}/screens`,
    fetcher,
  );
  // The standing picture, not the latest row: a spot-check covers a few tests
  // and the rest are still true.
  const standing = standingScreen(data ?? []);
  const summary = standing.last ? screenSummary(standing.results) : null;

  return (
    <Link href={`/tests/${athleteId}`} className="card pad screen-link">
      <div>
        <div className="eyebrow">Movement screen</div>
        <b>
          {summary
            ? summary.work > 0
              ? `${summary.work} ${summary.work === 1 ? "test" : "tests"} to work on`
              : "Nothing flagged"
            : "No screen recorded yet"}
        </b>
        {standing.last && (
          <span className="cz-note">Screened {fmtDate(standing.last)}</span>
        )}
      </div>
      <span className="sl-go">Open tests →</span>
    </Link>
  );
}
