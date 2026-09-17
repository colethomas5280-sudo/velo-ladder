"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import Dashboard from "./Dashboard";

type Me = {
  role: "coach" | "athlete" | "none";
  email: string;
  athleteId: string | null;
};

export default function HomeView() {
  const router = useRouter();
  const { data, isLoading, error } = useSWR<Me>("/api/me", fetcher);

  useEffect(() => {
    if (data?.role === "athlete" && data.athleteId) {
      router.replace(`/athletes/${data.athleteId}`);
    }
  }, [data, router]);

  if (isLoading || (data?.role === "athlete" && data.athleteId)) {
    return (
      <div className="card pad" style={{ color: "var(--ink-dim)" }}>
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="card pad" style={{ color: "var(--bad)" }}>
        Couldn&rsquo;t load your account. Reload the page.
      </div>
    );
  }
  if (data?.role === "none") {
    return (
      <div className="card pad empty">
        <div className="eyebrow">Velocity development</div>
        <h3>No tracker for this account</h3>
        <p>
          You&rsquo;re signed in as <b>{data.email}</b>, but that email isn&rsquo;t
          on the roster. Ask your coach to add it, then sign out and back in.
        </p>
      </div>
    );
  }
  return <Dashboard />;
}
