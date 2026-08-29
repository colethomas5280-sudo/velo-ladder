"use client";

import { useState } from "react";
import type { Athlete, Hand } from "@/lib/types";

export default function RosterManager({
  athletes,
  onAdd,
  onUpdate,
  onArchive,
}: {
  athletes: Athlete[];
  onAdd: (name: string, email: string, password: string) => Promise<void>;
  onUpdate: (id: string, patch: Partial<Athlete> & { password?: string }) => Promise<void>;
  onArchive: (a: Athlete) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPass, setResetPass] = useState("");

  const add = async () => {
    if (!newName.trim() || !newEmail.trim() || newPass.length < 6) return;
    await onAdd(newName.trim(), newEmail.trim(), newPass);
    setNewName("");
    setNewEmail("");
    setNewPass("");
  };

  const saveReset = async (id: string) => {
    if (resetPass.length < 6) return;
    await onUpdate(id, { password: resetPass });
    setResetFor(null);
    setResetPass("");
  };

  return (
    <details className="roster-d">
      <summary>Manage roster ({athletes.length})</summary>
      <div className="roster">
        {athletes.map((a) => (
          <div className="r" key={a.id} style={{ flexWrap: "wrap" }}>
            <input
              className="tin"
              defaultValue={a.name}
              aria-label="Athlete name"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== a.name) onUpdate(a.id, { name: v });
                else e.target.value = a.name;
              }}
            />
            <input
              className="tin em"
              type="email"
              placeholder="athlete@email.com"
              defaultValue={a.inviteEmail ?? ""}
              aria-label="Login email"
              onBlur={(e) => {
                const v = e.target.value.trim().toLowerCase();
                if (v !== (a.inviteEmail ?? ""))
                  onUpdate(a.id, { inviteEmail: v || null });
              }}
            />
            <select
              value={a.hand}
              aria-label="Throwing hand"
              onChange={(e) => onUpdate(a.id, { hand: e.target.value as Hand })}
            >
              <option value="">–</option>
              <option value="R">R</option>
              <option value="L">L</option>
            </select>
            <span className={a.hasPassword ? "linked" : "unlinked"}>
              {a.hasPassword ? "● password set" : "no password"}
            </span>
            <button
              className="btn sm ghost"
              onClick={() => {
                setResetFor(resetFor === a.id ? null : a.id);
                setResetPass("");
              }}
            >
              {a.hasPassword ? "Reset password" : "Set password"}
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                if (confirm(`Remove ${a.name} and all their sessions?`))
                  onArchive(a);
              }}
            >
              Remove
            </button>

            {resetFor === a.id && (
              <div
                style={{
                  flexBasis: "100%",
                  display: "flex",
                  gap: 8,
                  marginTop: 6,
                }}
              >
                <input
                  className="tin"
                  type="text"
                  autoFocus
                  placeholder="new password (min 6)"
                  value={resetPass}
                  onChange={(e) => setResetPass(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveReset(a.id)}
                />
                <button className="btn sm primary" onClick={() => saveReset(a.id)}>
                  Save
                </button>
              </div>
            )}
          </div>
        ))}

        <div className="r" style={{ borderBottom: 0, paddingTop: 12, flexWrap: "wrap" }}>
          <input
            className="tin"
            placeholder="New athlete name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="tin em"
            type="email"
            placeholder="their login email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <input
            className="tin"
            type="text"
            placeholder="password (min 6)"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="btn sm primary" onClick={add}>
            Add athlete
          </button>
        </div>
        <p
          style={{
            fontSize: 12,
            color: "var(--ink-faint)",
            margin: "8px 0 0",
          }}
        >
          Give each athlete their email + password directly. They can change the
          password once they&rsquo;re in.
        </p>
      </div>
    </details>
  );
}
