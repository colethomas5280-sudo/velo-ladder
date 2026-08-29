"use client";

import useSWR from "swr";
import { signOut } from "next-auth/react";
import { fetcher } from "@/lib/fetcher";
import Tracker from "./Tracker";

type Me = { role: "coach" | "athlete" | "none"; email: string };

export default function AppShell({ email }: { email: string }) {
  const { data, isLoading, error } = useSWR<Me>("/api/me", fetcher);
  const role = data?.role;

  return (
    <div className="wrap">
      <div className="appbar">
        <span className="mark">
          <span className="dot" />
          Velo Ladder
        </span>
        <span className="spacer" />
        <span className="who">
          {email}
          {role === "coach" ? " · coach" : ""}
        </span>
        <button
          className="btn sm ghost"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          Sign out
        </button>
      </div>

      {isLoading && (
        <div className="card pad" style={{ color: "var(--ink-dim)" }}>
          Loading…
        </div>
      )}

      {error && !isLoading && (
        <div className="card pad" style={{ color: "var(--bad)" }}>
          Couldn&rsquo;t load your account. Reload the page.
        </div>
      )}

      {role === "none" && (
        <div className="card pad empty">
          <div className="eyebrow">Velocity development</div>
          <h3>No tracker for this account</h3>
          <p>
            You&rsquo;re signed in as <b>{email}</b>, but that email isn&rsquo;t on
            the roster. Ask your coach to add it (or check you used the right
            email), then sign out and back in.
          </p>
        </div>
      )}

      {(role === "coach" || role === "athlete") && <Tracker role={role} />}
    </div>
  );
}
