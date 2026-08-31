"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { AthleteOverview, Hand } from "@/lib/types";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import { LEVELS } from "@/lib/leaderboard";
import { fmtDate } from "@/lib/velo";
import GroupSession from "./GroupSession";
import InviteAthleteModal from "./InviteAthleteModal";

export default function AthletesTable() {
  const { data, mutate, isLoading } = useSWR<AthleteOverview[]>(
    "/api/athletes/overview",
    fetcher,
  );
  const rows = useMemo(() => data ?? [], [data]);

  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [sessionIds, setSessionIds] = useState<string[] | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  const errMsg = (e: unknown) =>
    show(e instanceof ApiError ? e.message : "Something went wrong");

  const filtered = rows.filter((a) =>
    (a.name + " " + (a.inviteEmail ?? "")).toLowerCase().includes(q.toLowerCase()),
  );

  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(`/api/athletes/${id}`, "PATCH", body);
      await mutate();
    } catch (e) {
      errMsg(e);
    }
  };

  const archive = async (a: AthleteOverview) => {
    if (
      !confirm(
        `Remove ${a.name} from the active roster?\n\n` +
          `Their sessions are kept, and any leaderboard records they set stay ` +
          `on the boards under their name — every athlete in the facility still ` +
          `sees them there. Taking them off the leaderboard needs a full delete, ` +
          `not this.`,
      )
    )
      return;
    try {
      await api(`/api/athletes/${a.id}`, "DELETE");
      await mutate();
      setChecked((s) => {
        const n = new Set(s);
        n.delete(a.id);
        return n;
      });
      show(`Removed ${a.name}`);
    } catch (e) {
      errMsg(e);
    }
  };

  /**
   * Issue a fresh single-use link and put it on the clipboard. Each click
   * mints a new token, which also revokes any link already sent out.
   */
  const invite = async (a: AthleteOverview) => {
    if (!a.inviteEmail) {
      show("Add a login email for this athlete first");
      return;
    }
    setInviting(a.id);
    try {
      const res = await api<{ url: string; expiresInDays: number }>(
        `/api/athletes/${a.id}/invite`,
        "POST",
      );
      let copied = false;
      try {
        await navigator.clipboard.writeText(res.url);
        copied = true;
      } catch {
        /* clipboard blocked — fall back to showing the link */
      }
      await mutate();
      if (copied)
        show(`Invite link copied — good for ${res.expiresInDays} days`);
      else window.prompt("Copy this invite link and send it:", res.url);
    } catch (e) {
      errMsg(e);
    } finally {
      setInviting(null);
    }
  };

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const startSession = () => {
    const ids = rows.filter((a) => checked.has(a.id)).map((a) => a.id);
    if (ids.length < 1) return;
    setSessionIds(ids);
  };

  return (
    <div className="athletes-page">
      <div className="sec-h">
        <h3>Athletes</h3>
        <div className="sec-actions">
          <input
            className="tin"
            placeholder="Search name or email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn primary" onClick={() => setInviteOpen(true)}>
            + Invite athlete
          </button>
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="scroll-x">
          <table className="roster-table">
            <thead>
              <tr>
                <th style={{ width: 34 }} />
                <th>Name</th>
                <th>Login email</th>
                <th>Hand</th>
                <th>Level</th>
                <th>Date of birth</th>
                <th>Access</th>
                <th>Mound</th>
                <th>Pull-Down</th>
                <th>Last session</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={11} style={{ color: "var(--ink-dim)" }}>
                    Loading…
                  </td>
                </tr>
              )}
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked.has(a.id)}
                      onChange={() => toggle(a.id)}
                      aria-label={`Select ${a.name}`}
                    />
                  </td>
                  <td>
                    <Link href={`/athletes/${a.id}`} className="name-link">
                      {a.name}
                    </Link>
                  </td>
                  <td className="cell-edit">
                    <input
                      className="tin"
                      type="email"
                      defaultValue={a.inviteEmail ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim().toLowerCase();
                        if (v !== (a.inviteEmail ?? ""))
                          patch(a.id, { inviteEmail: v || null });
                      }}
                    />
                  </td>
                  <td>
                    <select
                      value={a.hand}
                      onChange={(e) =>
                        patch(a.id, { hand: e.target.value as Hand })
                      }
                    >
                      <option value="">–</option>
                      <option value="R">R</option>
                      <option value="L">L</option>
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`${a.name} level`}
                      value={a.level ?? ""}
                      onChange={(e) =>
                        patch(a.id, { level: e.target.value || null })
                      }
                    >
                      <option value="">–</option>
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="tin"
                      type="date"
                      aria-label={`${a.name} date of birth`}
                      value={a.birthDate ?? ""}
                      onChange={(e) =>
                        patch(a.id, { birthDate: e.target.value || null })
                      }
                    />
                  </td>
                  <td>
                    {resetFor === a.id ? (
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <input
                          className="tin"
                          autoFocus
                          placeholder="new pw (6+)"
                          value={resetPw}
                          onChange={(e) => setResetPw(e.target.value)}
                          style={{ width: 120 }}
                        />
                        <button
                          className="btn sm primary"
                          disabled={resetPw.length < 6}
                          onClick={async () => {
                            await patch(a.id, { password: resetPw });
                            setResetFor(null);
                            setResetPw("");
                            show("Password set");
                          }}
                        >
                          Save
                        </button>
                      </span>
                    ) : (
                      <span className="access-cell">
                        <button
                          className={`btn sm${a.hasPassword ? " ghost" : " primary"}`}
                          disabled={inviting === a.id}
                          onClick={() => invite(a)}
                          title={
                            a.inviteEmail
                              ? "Copy a single-use link that lets them set their own password"
                              : "Add a login email first"
                          }
                        >
                          {inviting === a.id
                            ? "…"
                            : a.hasPassword
                              ? "New invite"
                              : a.hasInvite
                                ? "Copy invite again"
                                : "Copy invite link"}
                        </button>
                        <button
                          className="btn sm ghost"
                          onClick={() => {
                            setResetFor(a.id);
                            setResetPw("");
                          }}
                        >
                          {a.hasPassword
                            ? "● active"
                            : a.hasInvite
                              ? "invite sent"
                              : "set password"}
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="mono">{a.mound}</td>
                  <td className="mono">{a.pulldown}</td>
                  <td className="mono">
                    {a.lastDate ? fmtDate(a.lastDate) : "–"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn sm danger"
                      onClick={() => archive(a)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ color: "var(--ink-dim)" }}>
                    No athletes match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>

      {checked.size > 0 && (
        <div className="select-bar">
          <span>
            {checked.size} selected
            <button
              className="btn sm ghost"
              onClick={() => setChecked(new Set())}
              style={{ marginLeft: 10 }}
            >
              clear
            </button>
          </span>
          <button className="btn primary" onClick={startSession}>
            Log a session for {checked.size} →
          </button>
        </div>
      )}

      {inviteOpen && (
        <InviteAthleteModal
          onClose={() => setInviteOpen(false)}
          onCreated={() => mutate()}
        />
      )}

      {sessionIds && (
        <GroupSession
          people={rows.map((a) => ({ id: a.id, name: a.name }))}
          ids={sessionIds}
          onSaved={() => mutate()}
          onClose={() => {
            setSessionIds(null);
            setChecked(new Set());
            mutate();
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
