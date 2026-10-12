"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/fetcher";
import {
  normalizePhone,
  formatPhone,
  inviteMessage,
  smsHref,
  defaultRecipient,
  type Recipient,
} from "@/lib/sms";

export interface InviteTarget {
  id: string;
  name: string;
  phone: string | null;
  guardianPhone: string | null;
  level: string | null;
}

type Reply = {
  url: string;
  expiresInDays: number;
  sms: { sent: boolean; reason?: string; detail?: string } | null;
  smsConfigured: boolean;
};

/**
 * Send an athlete their invite by text.
 *
 * Two endings, and which one you get depends on whether Twilio is wired up.
 * Configured: the server sends it and this reports back. Not configured: the
 * link still comes back and the coach gets a button that opens their own
 * Messages app with the number and wording already filled in. The second path
 * is not a degraded mode — it needs no carrier registration, and the text
 * arrives from the number families already have saved.
 */
export default function TextInvite({
  athlete,
  smsConfigured,
  onClose,
  onSent,
}: {
  athlete: InviteTarget;
  smsConfigured: boolean;
  onClose: () => void;
  onSent?: () => void;
}) {
  const own = normalizePhone(athlete.phone);
  const guardian = normalizePhone(athlete.guardianPhone);

  const [who, setWho] = useState<Recipient | null>(() =>
    defaultRecipient(athlete),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Reply | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const to = who === "guardian" ? guardian : who === "athlete" ? own : null;
  const body = useMemo(
    () => (res ? inviteMessage(athlete.name, res.url) : ""),
    [res, athlete.name],
  );

  async function send() {
    if (!to || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Reply>(`/api/athletes/${athlete.id}/invite`, "POST", {
        to,
      });
      setRes(r);
      onSent?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't issue that invite.");
    } finally {
      setBusy(false);
    }
  }

  const sent = res?.sms?.sent === true;
  // Twilio is absent, or it rejected the message. Either way the coach can
  // still send it himself, so offer that rather than just an apology.
  const handoff = res != null && !sent;

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
            {sent ? "Invite sent" : handoff ? "Ready to send" : "Text invite"}
          </span>
          <span className="modal-sub">{athlete.name}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="type-pick">
          {!res && (
            <>
              {own == null && guardian == null ? (
                <p className="type-pick-q">
                  No phone number on <b>{athlete.name}</b>&rsquo;s profile yet.
                  Add one on their profile, then come back here.
                </p>
              ) : (
                <>
                  <p className="type-pick-q">Who should get the link?</p>
                  <div className="who-pick">
                    {own && (
                      <label className={`who-opt${who === "athlete" ? " on" : ""}`}>
                        <input
                          type="radio"
                          name="recipient"
                          checked={who === "athlete"}
                          onChange={() => setWho("athlete")}
                        />
                        <span>
                          <b>{athlete.name}</b>
                          <em>{formatPhone(own)}</em>
                        </span>
                      </label>
                    )}
                    {guardian && (
                      <label
                        className={`who-opt${who === "guardian" ? " on" : ""}`}
                      >
                        <input
                          type="radio"
                          name="recipient"
                          checked={who === "guardian"}
                          onChange={() => setWho("guardian")}
                        />
                        <span>
                          <b>Parent / guardian</b>
                          <em>{formatPhone(guardian)}</em>
                        </span>
                      </label>
                    )}
                  </div>
                  {err && (
                    <p className="form-error" role="alert">
                      {err}
                    </p>
                  )}
                  <button
                    className="btn primary"
                    disabled={!to || busy}
                    onClick={send}
                  >
                    {busy
                      ? "Working…"
                      : smsConfigured
                        ? "Send text"
                        : "Write the text"}
                  </button>
                  <p className="type-pick-note">
                    {smsConfigured
                      ? "Sends straight from Velo Ladder. The link works once and expires in 14 days."
                      : "Opens your own Messages app with it written out, so it arrives from your number."}
                  </p>
                </>
              )}
            </>
          )}

          {sent && (
            <>
              <p className="type-pick-q">
                Texted to <b>{formatPhone(to)}</b>. Good for{" "}
                {res!.expiresInDays} days, and it works once.
              </p>
              <button className="btn primary" onClick={onClose}>
                Done
              </button>
            </>
          )}

          {handoff && (
            <>
              <p className="type-pick-q">
                {res!.sms?.reason === "send_failed"
                  ? "Velo Ladder couldn't send that text, so send it yourself:"
                  : "Tap below and your Messages app opens with it written out."}
              </p>
              {res!.sms?.reason === "send_failed" && res!.sms?.detail && (
                <p className="form-error" role="alert">
                  {res!.sms.detail}
                </p>
              )}
              <a className="btn primary" href={smsHref(to!, body)}>
                Open Messages to {formatPhone(to)}
              </a>
              <details className="roster-d">
                <summary>Or copy the link</summary>
                <input
                  className="tin invite-link"
                  readOnly
                  value={res!.url}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </details>
              <button className="btn ghost" onClick={onClose}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
