export default function VerifyRequestPage() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Check your email</h1>
        <p>
          A sign-in link is on its way. Open it on this device within 15 minutes.
          You can close this tab.
        </p>
        <a className="btn ghost sm" href="/login">
          Back to sign in
        </a>
      </div>
    </div>
  );
}
