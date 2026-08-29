"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", {
      email: email.trim(),
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Wrong email or password.");
    } else {
      router.push("/");
      router.refresh();
    }
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
      <p>Sign in with the email and password your coach gave you.</p>
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
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        {error && <p style={{ color: "var(--bad)", margin: 0 }}>{error}</p>}
      </form>
    </div>
  );
}
