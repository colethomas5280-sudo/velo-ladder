"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { signOut } from "next-auth/react";
import { fetcher } from "@/lib/fetcher";

type Me = { role: "coach" | "athlete" | "none"; email: string; athleteId: string | null };

export default function AppHeader({ email }: { email?: string }) {
  const { data } = useSWR<Me>("/api/me", fetcher);
  const path = usePathname();
  const isCoach = data?.role === "coach";
  const isAthlete = data?.role === "athlete";

  // Athletes get a link back to their own profile; coaches get the roster.
  const links: { href: string; label: string }[] = isCoach
    ? [
        { href: "/", label: "Dashboard" },
        { href: "/athletes", label: "Athletes" },
        { href: "/leaderboard", label: "Leaderboard" },
        { href: "/resources", label: "Resources" },
      ]
    : isAthlete
      ? [
          {
            href: data?.athleteId ? `/athletes/${data.athleteId}` : "/",
            label: "My tracker",
          },
          { href: "/profile", label: "My profile" },
          { href: "/leaderboard", label: "Leaderboard" },
          { href: "/resources", label: "Resources" },
        ]
      : [];

  return (
    <div className="appbar">
      <Link href="/" className="mark">
        <span className="dot" />
        Velo Ladder
      </Link>
      {links.length > 0 && (
        <nav className="topnav">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={path === l.href ? "page" : undefined}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
      <span className="spacer" />
      {(email || data?.email) && (
        <span className="who">{email ?? data?.email}</span>
      )}
      <button
        className="btn sm ghost"
        onClick={() => signOut({ callbackUrl: "/login" })}
      >
        Sign out
      </button>
    </div>
  );
}
