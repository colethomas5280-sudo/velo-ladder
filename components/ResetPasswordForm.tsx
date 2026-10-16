"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { api, ApiError } from "@/lib/fetcher";

const goTo = (to: string) => {
  window.location.href = to;
};

/**
 * Choose a new password from an emailed link. The server has already checked
 * the link before this renders; the confirm call checks it again, because the
 * link can be spent between the page loading and the button being pressed.
 *
 * `redirect` is injectable only so tests can observe where it would go.
 */
export default function ResetPasswordForm({
  token,
  redirect = goTo,
}: {
  token: string;
  redirect?: (to: string) => void;
}) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mismatch = pw2.length > 0 && pw !== pw2;
  const canSubmit = pw.length >= 6 && pw === pw2 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ email: string | null }>(
        "/api/password-reset/confirm",
        "POST",
        { token, password: pw },
      );
      // The link already proved they control the email, so sign them straight
      // in rather than making them type what they just chose.
      if (res.email) {
        const r = await signIn("credentials", {
          email: res.email,
          password: pw,
          redirect: false,
        });
        if (!r?.error) {
          redirect("/");
          return;
        }
      }
      redirect("/login");
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
      <div className="eyebrow">Password reset</div>
      <h3>Choose a new password</h3>

      <label className="field" style={{ marginTop: 6 }}>
        <span>New password</span>
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
        {busy ? "Saving…" : "Set new password"}
      </button>
    </div>
  );
}
