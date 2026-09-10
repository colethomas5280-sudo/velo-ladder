"use client";

import Link from "next/link";
import useSWR from "swr";
import type { Athlete } from "@/lib/types";
import { fetcher, ApiError } from "@/lib/fetcher";
import type { Hand, RescreenCall } from "@/lib/screen";
import ScreenPanel from "./ScreenPanel";

type Me = { role: "coach" | "athlete" | "none"; athleteId: string | null };

/** The athlete's standing re-screen call, if their row carries one. */
export function callOf(athlete?: Athlete | null): RescreenCall | null {
  if (!athlete?.rescreenSince) return null;
  return {
    since: athlete.rescreenSince,
    reason: athlete.rescreenReason ?? "Re-screen called",
  };
}

/** Only R or L places the arm-test caveat; anything else waives nothing. */
export function handOf(hand: string | null | undefined): Hand | null {
  return hand === "R" || hand === "L" ? hand : null;
}

/** One athlete's tests, reached from the Tests roster or from their profile. */
export default function AthleteTests({ athleteId }: { athleteId: string }) {
  const { data: me } = useSWR<Me>("/api/me", fetcher);
  const {
    data: athlete,
    error,
    mutate,
  } = useSWR<Athlete>(`/api/athletes/${athleteId}`, fetcher);
  const isCoach = me?.role === "coach";

  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return (
      <div className="card pad empty">
        <div className="eyebrow">Testing</div>
        <h3>Not your athlete</h3>
        <p>
          <Link href="/tests">Back to tests</Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="tests-head">
        {isCoach && (
          <Link href="/tests" className="back-link">
            ← All athletes
          </Link>
        )}
        <div className="eyebrow">Testing</div>
        <h2>{athlete?.name ?? "…"}</h2>
      </div>
      <ScreenPanel
        athleteId={athleteId}
        athleteName={athlete?.name ?? ""}
        hand={handOf(athlete?.hand)}
        call={callOf(athlete)}
        phase={athlete?.phase ?? null}
        isCoach={!!isCoach}
        onCalled={() => mutate()}
      />
    </>
  );
}
