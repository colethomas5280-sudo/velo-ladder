"use client";

import { useEffect, useState } from "react";
import type { Athlete } from "@/lib/types";
import { api, ApiError } from "@/lib/fetcher";

/**
 * Create an athlete and get their invite to them in one go — the normal way a
 * new athlete gets added.
 *
 * With email configured the server sends the invite to the login email just
 * entered, and this says so. Without it the form behaves as it always did: the
 * link is copied and shown. Either way the link is on screen, so a failed send
 * or a blocked clipboard never loses it.
 */
export default function InviteAthleteModal({
  emailConfigured,
  onClose,
  onCreated,
}: {
  emailConfigured: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Set once the server has emailed the invite. */
  const [emailedTo, setEmailedTo] = useState<string | null>(null);
  /** Set when an email was wanted but the server could not send it. */
  const [sendErr, setSendErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const canSubmit = name.trim() && email.trim() && !busy;

  async function create() {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const a = await api<Athlete>("/api/athletes", "POST", {
        name: name.trim(),
        inviteEmail: email.trim(),
      });
      const inv = await api<{
        url: string;
        email: { sent: boolean; to?: string; detail?: string; reason?: string } | null;
      }>(`/api/athletes/${a.id}/invite`, "POST", emailConfigured ? { channel: "email" } : {});
      onCreated();
      setLink(inv.url);

      if (inv.email?.sent) {
        setEmailedTo(inv.email.to ?? email.trim());
      } else if (inv.email) {
        setSendErr(inv.email.detail ?? "The email could not be sent.");
      } else {
        try {
          await navigator.clipboard.writeText(inv.url);
          setCopied(true);
        } catch {
          /* clipboard blocked — the link is on screen to copy by hand */
        }
      }
    } catch (e) {
      setErr(
        e instanceof ApiError ? e.message : "Couldn't create that athlete.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyAgain() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const sent = emailedTo !== null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel narrow"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">
            {sent ? "Invite emailed" : link ? "Invite ready" : "Invite an athlete"}
          </span>
          <span className="modal-sub" />
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="type-pick">
          {sent ? (
            <>
              <p className="type-pick-q">
                Emailed to <b>{emailedTo}</b>. {name.trim()} sets their own
                password from the link; it works once and expires in 14 days.
              </p>
              <details className="roster-d">
                <summary>Or copy the link</summary>
                <input
                  className="tin invite-link"
                  readOnly
                  value={link ?? ""}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </details>
              <button className="btn primary" onClick={onClose}>
                Done
              </button>
            </>
          ) : link ? (
            <>
              {sendErr ? (
                <>
                  <p className="type-pick-q">
                    The athlete was added, but Velo Ladder couldn&rsquo;t email
                    the invite. Send <b>{name.trim()}</b> this link yourself:
                  </p>
                  <p className="form-error" role="alert">
                    {sendErr}
                  </p>
                </>
              ) : (
                <p className="type-pick-q">
                  Send <b>{name.trim()}</b> this link. They&rsquo;ll set their
                  own password and be signed in. It works once and expires in 14
                  days.
                </p>
              )}
              <input
                className="tin invite-link"
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" onClick={copyAgain}>
                  {copied ? "Copied ✓" : "Copy link"}
                </button>
                <button className="btn ghost" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="field">
                <span>Athlete name</span>
                <input
                  className="tin"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && create()}
                />
              </label>
              <label className="field">
                <span>Login email</span>
                <input
                  className="tin"
                  type="email"
                  placeholder="they sign in with this"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && create()}
                />
              </label>
              {err && (
                <p className="form-error" role="alert">
                  {err}
                </p>
              )}
              <button
                className="btn primary"
                disabled={!canSubmit}
                onClick={create}
              >
                {busy
                  ? "Creating…"
                  : emailConfigured
                    ? "Create & email the invite"
                    : "Create & copy invite link"}
              </button>
              <p className="type-pick-note">
                {emailConfigured
                  ? "No password needed. The invite goes straight to that email and they choose their own from the link."
                  : "No password needed. They choose their own from the link. Email isn't set up yet, so the link is copied for you to send."}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
