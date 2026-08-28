"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setLoading(true);
    setError(null);
    try {
      const res = await signIn("nodemailer", {
        email: addr,
        redirect: false,
        callbackUrl: "/",
      });
      if (res?.error) {
        setError("Couldn't send the link. Check the address and try again.");
      } else {
        setSent(addr);
      }
    } catch {
      setError("Something went wrong sending the link.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="login-card">
        <h1>Check your email</h1>
        <p>
          We sent a sign-in link to <b>{sent}</b>. It works for 15 minutes. You can
          close this tab.
        </p>
        <button
          className="btn ghost sm"
          onClick={() => {
            setSent(null);
            setEmail("");
          }}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="login-card">
      <h1>
        <span
          style={{
            display: "inline-block",
            width: 11,
            height: 11,
            borderRadius: "50%",
            background: "var(--accent)",
            marginRight: 8,
            verticalAlign: "middle",
          }}
        />
        Velo Ladder
      </h1>
      <p>
        Enter your email and we&rsquo;ll send you a one-tap sign-in link. No
        password.
      </p>
      <form onSubmit={submit}>
        <input
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? "Sending…" : "Send sign-in link"}
        </button>
        {error && (
          <p style={{ color: "var(--bad)", margin: 0 }}>{error}</p>
        )}
      </form>
    </div>
  );
}
