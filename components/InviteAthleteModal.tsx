"use client";

import { useEffect, useState } from "react";
import type { Athlete } from "@/lib/types";
import { api, ApiError } from "@/lib/fetcher";

/**
 * Create an athlete and mint their invite link in one go — the normal way a
 * new athlete gets added. The link is shown as well as copied, so a blocked
 * clipboard never loses it.
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      const inv = await api<{ url: string }>(
        `/api/athletes/${a.id}/invite`,
        "POST",
      );
      onCreated();
      setLink(inv.url);
      try {
        await navigator.clipboard.writeText(inv.url);
        setCopied(true);
      } catch {
        /* clipboard blocked — the link is on screen to copy by hand */
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
            {link ? "Invite ready" : "Invite an athlete"}
          </span>
          <span className="modal-sub" />
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="type-pick">
          {link ? (
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
                {busy ? "Creating…" : "Create & copy invite link"}
              </button>
              <p className="type-pick-note">
                No password needed — they choose their own from the link.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
