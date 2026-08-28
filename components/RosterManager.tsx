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
  onAdd: (name: string, email: string) => Promise<void>;
  onUpdate: (id: string, patch: Partial<Athlete>) => Promise<void>;
  onArchive: (a: Athlete) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const add = async () => {
    if (!newName.trim()) return;
    await onAdd(newName.trim(), newEmail.trim());
    setNewName("");
    setNewEmail("");
  };

  return (
    <details className="roster-d">
      <summary>Manage roster ({athletes.length})</summary>
      <div className="roster">
        {athletes.map((a) => (
          <div className="r" key={a.id}>
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
              aria-label="Invite email"
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
            <span className={a.userId ? "linked" : "unlinked"}>
              {a.userId ? "● signed in" : "not yet joined"}
            </span>
            <button
              className="btn sm danger"
              onClick={() => {
                if (confirm(`Remove ${a.name} and all their sessions?`))
                  onArchive(a);
              }}
            >
              Remove
            </button>
          </div>
        ))}

        <div className="r" style={{ borderBottom: 0, paddingTop: 10 }}>
          <input
            className="tin"
            placeholder="New athlete name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <input
            className="tin em"
            type="email"
            placeholder="their email (for login)"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="btn sm primary" onClick={add}>
            Add
          </button>
        </div>
      </div>
    </details>
  );
}
