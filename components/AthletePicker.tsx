"use client";

import { useEffect, useMemo, useState } from "react";

export interface PickPerson {
  id: string;
  name: string;
}

/**
 * Choose who is in a session or a test. One component for both homepage
 * flows. Picks are held by id, so an athlete filtered out of view by the
 * search is still picked, and Start returns ids in roster order.
 */
export default function AthletePicker({
  title,
  startLabel,
  people,
  onStart,
  onClose,
}: {
  title: string;
  startLabel: (picked: number) => string;
  people: PickPerson[];
  onStart: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? people.filter((p) => p.name.toLowerCase().includes(needle)) : people;
  }, [people, q]);

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel narrow"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="picker">
          <input
            className="tin"
            type="search"
            placeholder="Search athletes"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="picker-bar">
            <span>{picked.size} selected</span>
            <span className="picker-actions">
              <button
                className="btn sm ghost"
                disabled={shown.length === 0}
                onClick={() =>
                  setPicked((s) => new Set([...s, ...shown.map((p) => p.id)]))
                }
              >
                Select all
              </button>
              <button
                className="btn sm ghost"
                disabled={picked.size === 0}
                onClick={() => setPicked(new Set())}
              >
                Clear
              </button>
            </span>
          </div>

          {people.length === 0 ? (
            <p className="picker-empty">No athletes yet.</p>
          ) : shown.length === 0 ? (
            <p className="picker-empty">No one matches that.</p>
          ) : (
            <ul className="picker-list">
              {shown.map((p) => (
                <li key={p.id}>
                  <label className="picker-row">
                    <input
                      type="checkbox"
                      aria-label={p.name}
                      checked={picked.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <span>{p.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <button
            className="btn primary"
            disabled={picked.size === 0}
            onClick={() =>
              onStart(people.filter((p) => picked.has(p.id)).map((p) => p.id))
            }
          >
            {startLabel(picked.size)}
          </button>
        </div>
      </div>
    </div>
  );
}
