import type { Metadata } from "next";
import { getResetTarget } from "@/lib/passwordReset";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export const dynamic = "force-dynamic";
// The URL carries a secret, so no Referer header may leak it onward.
export const metadata: Metadata = { referrer: "no-referrer" };

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const target = await getResetTarget(token);
  return (
    <div className="wrap">
      <div className="appbar">
        <span className="mark">
          <span className="dot" />
          Velo Ladder
        </span>
      </div>
      {target ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="card pad login-card">
          <h3>This link isn&rsquo;t valid</h3>
          <p style={{ color: "var(--ink-dim)", fontSize: 13.5 }}>
            It may have expired or already been used. You can ask for a new one.
          </p>
          <a className="btn primary" href="/forgot-password">
            Send me a new link
          </a>
        </div>
      )}
    </div>
  );
}
