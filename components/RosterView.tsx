"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import AthletesTable from "./AthletesTable";

type Me = { role: "coach" | "athlete" | "none"; athleteId: string | null };

/** The roster is coach-only; anyone else is bounced to where they belong. */
export default function RosterView() {
  const router = useRouter();
  const { data, isLoading } = useSWR<Me>("/api/me", fetcher);

  useEffect(() => {
    if (!data) return;
    if (data.role === "athlete" && data.athleteId)
      router.replace(`/athletes/${data.athleteId}`);
    else if (data.role === "none") router.replace("/");
  }, [data, router]);

  if (isLoading || data?.role !== "coach")
    return (
      <div className="card pad" style={{ color: "var(--ink-dim)" }}>
        Loading…
      </div>
    );
  return <AthletesTable />;
}
