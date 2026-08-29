"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { signOut } from "next-auth/react";
import { fetcher } from "@/lib/fetcher";

type Me = { role: "coach" | "athlete" | "none"; email: string };

export default function AppHeader({
  email,
  back = false,
}: {
  email?: string;
  back?: boolean;
}) {
  const { data } = useSWR<Me>("/api/me", fetcher);
  const isCoach = data?.role === "coach";
  const path = usePathname();

  return (
    <div className="appbar">
      <Link href="/" className="mark">
        <span className="dot" />
        Velo Ladder
      </Link>
      {back && isCoach && (
        <Link href="/athletes" className="back-link">
          ← Athletes
        </Link>
      )}
      {!back && isCoach && (
        <nav className="topnav">
          <Link href="/" aria-current={path === "/" ? "page" : undefined}>
            Dashboard
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
