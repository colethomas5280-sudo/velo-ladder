"use client";

import { useState } from "react";
import { api } from "@/lib/fetcher";

const CONFIRM =
  "If that email is on a Velo Ladder account, we've sent a reset link. It works for 1 hour.";

/**
 * Ask for a reset link by email. The confirmation is the same whatever was
 * typed: telling a stranger "no such account" would let them learn who is on
 * the roster, and many of these athletes are minors.
 */
export default function ForgotPasswordForm({ available }: { available: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/api/password-reset/request", "POST", { email: email.trim() });
      setDone(true);
    } catch {
      setErr("Couldn't send that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-card">
      <h1>Reset your password</h1>
      {!available ? (
        <p>Password reset by email isn&rsquo;t available right now. Ask your coach for a new invite.</p>
      ) : done ? (
        <p>{CONFIRM}</p>
      ) : (
        <form onSubmit={submit}>
          <p>Enter the email you sign in with and we&rsquo;ll send you a link.</p>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button className="btn primary" type="submit" disabled={!email.trim() || busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          {err && (
            <p className="form-error" role="alert">
              {err}
            </p>
          )}
        </form>
      )}
      <p className="login-help">
        <a href="/login">Back to sign in</a>
      </p>
    </div>
  );
}
