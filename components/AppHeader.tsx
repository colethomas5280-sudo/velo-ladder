"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { signOut } from "next-auth/react";
import { fetcher } from "@/lib/fetcher";

type Me = { role: "coach" | "athlete" | "none"; email: string };

export default function AppHeader() {
  const { data } = useSWR<Me>("/api/me", fetcher);
  const path = usePathname();
  const isCoach = data?.role === "coach";

  return (
    <div className="appbar">
      <Link href="/" className="mark">
        <span className="dot" />
        Velo Ladder
      </Link>
      {isCoach && (
        <nav className="topnav">
          <Link href="/" aria-current={path === "/" ? "page" : undefined}>
            Tracker
          </Link>
          <Link
            href="/athletes"
            aria-current={path === "/athletes" ? "page" : undefined}
          >
            Athletes
          </Link>
        </nav>
      )}
      <span className="spacer" />
      {data && (
        <span className="who">
          {data.email}
          {isCoach ? " · coach" : ""}
        </span>
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
