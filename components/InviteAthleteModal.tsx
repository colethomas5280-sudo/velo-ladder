"use client";

import { useEffect, useState } from "react";
import type { Athlete } from "@/lib/types";
import { api, ApiError } from "@/lib/fetcher";
import { normalizePhone, formatPhone, inviteMessage, smsHref } from "@/lib/sms";

/**
 * Create an athlete and get their invite to them in one go — the normal way a
 * new athlete gets added.
 *
 * A phone number turns this into a text. When Twilio is configured the server
 * sends it; otherwise the coach gets a button that opens their own Messages
 * app pre-written. Leave the phone blank and it behaves as it always did, with
 * the link shown as well as copied so a blocked clipboard never loses it.
 */
export default function InviteAthleteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  /** Set when a text was wanted but the server could not send it itself. */
  const [handoff, setHandoff] = useState<{ to: string; body: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const wantsText = phone.trim().length > 0;
  const phoneOk = !wantsText || normalizePhone(phone) != null;
  const canSubmit = name.trim() && email.trim() && phoneOk && !busy;

  async function create() {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const to = normalizePhone(phone);
      const a = await api<Athlete>("/api/athletes", "POST", {
        name: name.trim(),
        inviteEmail: email.trim(),
        // Stored on the athlete first, which is also what lets the invite
        // route confirm the text is going to a number on their own profile.
        phone: to,
      });
      const inv = await api<{
        url: string;
        sms: { sent: boolean } | null;
      }>(`/api/athletes/${a.id}/invite`, "POST", to ? { to } : {});
      onCreated();
      setLink(inv.url);

      if (to && inv.sms?.sent) {
        setSent(to);
      } else if (to) {
        setHandoff({ to, body: inviteMessage(name.trim(), inv.url) });
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
            {sent ? "Invite texted" : link ? "Invite ready" : "Invite an athlete"}
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
                Texted to <b>{formatPhone(sent)}</b>. {name.trim()} sets their
                own password from the link; it works once and expires in 14 days.
              </p>
              <button className="btn primary" onClick={onClose}>
                Done
              </button>
            </>
          ) : handoff ? (
            <>
              <p className="type-pick-q">
                Tap below and your Messages app opens with it written out to{" "}
                <b>{formatPhone(handoff.to)}</b>.
              </p>
              <a
                className="btn primary"
                href={smsHref(handoff.to, handoff.body)}
              >
                Open Messages
              </a>
              <details className="roster-d">
                <summary>Or copy the link</summary>
                <input
                  className="tin invite-link"
                  readOnly
                  value={link ?? ""}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </details>
              <button className="btn ghost" onClick={onClose}>
                Done
              </button>
            </>
          ) : link ? (
            <>
              <p className="type-pick-q">
                Send <b>{name.trim()}</b> this link. They&rsquo;ll set their own
                password and be signed in. It works once and expires in 14 days.
              </p>
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
              <label className="field">
                <span>Mobile number (optional)</span>
                <input
                  className="tin"
                  type="tel"
                  inputMode="tel"
                  placeholder="(555) 123-4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && create()}
                />
              </label>
              {wantsText && !phoneOk && (
                <p className="form-error">
                  That number doesn&rsquo;t look right. 10 digits, or leave it
                  blank to copy the link instead.
                </p>
              )}
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
                  : wantsText
                    ? "Create & text the invite"
                    : "Create & copy invite link"}
              </button>
              <p className="type-pick-note">
                No password needed. They choose their own from the link. A
                number here texts it to them; leave it blank to copy instead.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
