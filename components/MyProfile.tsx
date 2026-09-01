"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import ProfileSummary from "./ProfileSummary";

type Me = {
  role: "coach" | "athlete" | "none";
  email: string;
  athleteId: string | null;
};

/*
 * The athlete's own door to the profile form. The page is a server component
 * that only gates on auth — every other page in this app resolves the viewer
 * through /api/me rather than querying the database from a server component,
 * and this one does the same.
 */
export default function MyProfile() {
  const { data, isLoading, error } = useSWR<Me>("/api/me", fetcher);

  if (isLoading) return <p className="widget-empty">Loading…</p>;
  if (error || !data)
    return (
      <p className="widget-empty">
        Couldn&rsquo;t load your account. Reload the page.
      </p>
    );

  if (data.athleteId)
    return (
      <ProfileSummary athleteId={data.athleteId} isCoach={false} />
    );

  if (data.role === "coach")
    return (
      <div className="card pad empty">
        <div className="eyebrow">Profile</div>
        <h3>Coaches don&rsquo;t have a profile</h3>
        <p>
          Open an athlete from <b>Athletes</b> to see and edit their profile.
        </p>
      </div>
    );

  return (
    <div className="card pad empty">
      <div className="eyebrow">Profile</div>
      <h3>No tracker for this account</h3>
      <p>
        You&rsquo;re signed in as <b>{data.email}</b>, but that email isn&rsquo;t
        on the roster. Ask your coach to add it, then sign out and back in.
      </p>
    </div>
  );
}
