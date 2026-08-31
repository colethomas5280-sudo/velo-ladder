"use client";

import { useState } from "react";
import useSWR from "swr";
import { signIn } from "next-auth/react";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import { LEVELS } from "@/lib/leaderboard";

type Invite = { name: string; email: string | null };

export default function JoinForm({ token }: { token: string }) {
  const { data, error, isLoading } = useSWR<Invite>(
    `/api/join/${token}`,
    fetcher,
    { shouldRetryOnError: false },
  );

  const [level, setLevel] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="card pad login-card" style={{ color: "var(--ink-dim)" }}>
        Checking your invite…
      </div>
    );
  }

  if (error) {
    return (
      <div className="card pad login-card">
        <h3>This link isn&rsquo;t valid</h3>
        <p style={{ color: "var(--ink-dim)", fontSize: 13.5 }}>
          It may have already been used, or it expired. Ask your coach to send
          you a new one.
        </p>
        <a className="btn" href="/login">
          Go to sign in
        </a>
      </div>
    );
  }

  const mismatch = pw2.length > 0 && pw !== pw2;
  const canSubmit = pw.length >= 6 && pw === pw2 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ email: string | null }>(
        `/api/join/${token}`,
        "POST",
        { password: pw, level: level || null, birthDate: birthDate || null },
      );
      // Password is set — sign them straight in rather than bouncing to /login.
      if (res.email) {
        const r = await signIn("credentials", {
          email: res.email,
          password: pw,
          redirect: false,
        });
        if (!r?.error) {
          window.location.href = "/";
          return;
        }
      }
      window.location.href = "/login";
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? e.message
          : "Couldn't set your password. Check your connection and try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="card pad login-card">
      <div className="eyebrow">Velocity development</div>
      <h3>Welcome, {data?.name}</h3>
      <p style={{ color: "var(--ink-dim)", fontSize: 13.5, marginTop: 4 }}>
        Pick a password and you&rsquo;re in. You&rsquo;ll sign in with{" "}
        <b>{data?.email}</b>.
      </p>

      <label className="field" style={{ marginTop: 6 }}>
        <span>Your level</span>
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">Choose…</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Date of birth</span>
        <input
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Password</span>
        <input
          type="password"
          autoComplete="new-password"
          placeholder="at least 6 characters"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Confirm password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </label>

      {mismatch && (
        <p className="form-error" role="alert">
          Those two passwords don&rsquo;t match.
        </p>
      )}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      <button className="btn primary" disabled={!canSubmit} onClick={submit}>
        {busy ? "Setting up…" : "Set password & start tracking"}
      </button>
    </div>
  );
}
