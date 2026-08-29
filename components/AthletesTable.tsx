"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { AthleteOverview, Hand } from "@/lib/types";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import { fmtDate } from "@/lib/velo";

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
  const [nn, setNn] = useState("");
  const [ne, setNe] = useState("");
  const [np, setNp] = useState("");

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
    if (!confirm(`Remove ${a.name} and all their sessions?`)) return;
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

  const addAthlete = async () => {
    if (!nn.trim() || !ne.trim() || np.length < 6) return;
    try {
      await api("/api/athletes", "POST", {
        name: nn.trim(),
        inviteEmail: ne.trim(),
        password: np,
      });
      await mutate();
      setNn("");
      setNe("");
      setNp("");
      show(`Added ${nn.trim()}`);
    } catch (e) {
      errMsg(e);
    }
  };

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const startSession = () => {
    const ids = filtered.filter((a) => checked.has(a.id)).map((a) => a.id);
    if (ids.length < 1) return;
    try {
      window.localStorage.setItem("veloladder:group", JSON.stringify(ids));
    } catch {
      /* ignore */
    }
    window.location.href = "/";
  };

  return (
    <div className="athletes-page">
      <div className="sec-h">
        <h3>Athletes</h3>
        <input
          className="tin"
          placeholder="Search name or email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 220 }}
        />
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
                <th>Password</th>
                <th>Mound</th>
                <th>Pull-Down</th>
                <th>Last session</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={9} style={{ color: "var(--ink-dim)" }}>
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
                  <td className="cell-edit">
                    <input
                      className="tin"
                      defaultValue={a.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== a.name) patch(a.id, { name: v });
                        else e.target.value = a.name;
                      }}
                    />
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
                      <button
                        className="btn sm ghost"
                        onClick={() => {
                          setResetFor(a.id);
                          setResetPw("");
                        }}
                      >
                        {a.hasPassword ? "● set · reset" : "set password"}
                      </button>
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
                  <td colSpan={9} style={{ color: "var(--ink-dim)" }}>
                    No athletes match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="add-athlete">
          <input
            className="tin"
            placeholder="New athlete name"
            value={nn}
            onChange={(e) => setNn(e.target.value)}
          />
          <input
            className="tin"
            type="email"
            placeholder="login email"
            value={ne}
            onChange={(e) => setNe(e.target.value)}
          />
          <input
            className="tin"
            placeholder="password (6+)"
            value={np}
            onChange={(e) => setNp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAthlete()}
          />
          <button className="btn sm primary" onClick={addAthlete}>
            Add athlete
          </button>
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
