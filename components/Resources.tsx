"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { Resource } from "@/lib/types";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import RichText from "./RichText";

type Me = { role: "coach" | "athlete" | "none" };

export default function Resources() {
  const { data: me } = useSWR<Me>("/api/me", fetcher);
  const { data, mutate, isLoading } = useSWR<Resource[]>(
    "/api/resources",
    fetcher,
  );
  const isCoach = me?.role === "coach";
  const rows = useMemo(() => data ?? [], [data]);

  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Resource | "new" | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  const filtered = rows.filter((r) =>
    (r.title + " " + r.category + " " + r.body)
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  const groups = [...new Set(filtered.map((r) => r.category || "General"))];

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  async function remove(r: Resource) {
    if (!confirm(`Remove "${r.title}" from resources?`)) return;
    try {
      await api(`/api/resources/${r.id}`, "DELETE");
      await mutate();
      show("Removed");
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Couldn't remove that");
    }
  }

  return (
    <div className="resources">
      <div className="sec-h">
        <h3>Resources</h3>
        <div className="sec-actions">
          {rows.length > 0 && (
            <input
              className="tin"
              placeholder="Search resources…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
          {isCoach && (
            <button className="btn primary" onClick={() => setEditing("new")}>
              + Add resource
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="card pad" style={{ color: "var(--ink-dim)" }}>
          Loading…
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="card pad empty">
          <div className="eyebrow">Training library</div>
          <h3>Nothing here yet</h3>
          <p>
            {isCoach
              ? "Put your protocols, warm-ups and how-tos here once, and send athletes to this page instead of explaining it each time."
              : "Your coach hasn't added anything yet. Check back soon."}
          </p>
        </div>
      )}

      {!isLoading && filtered.length === 0 && rows.length > 0 && (
        <div className="card pad" style={{ color: "var(--ink-dim)" }}>
          Nothing matches &ldquo;{q}&rdquo;.
        </div>
      )}

      {groups.map((g) => (
        <section key={g} className="res-group">
          <div className="eyebrow">{g}</div>
          <div className="res-list">
            {filtered
              .filter((r) => (r.category || "General") === g)
              .map((r) => {
                const isOpen = open.has(r.id);
                return (
                  <article
                    key={r.id}
                    className={`card res${isOpen ? " open" : ""}`}
                  >
                    <button
                      className="res-head"
                      onClick={() => toggle(r.id)}
                      aria-expanded={isOpen}
                    >
                      <span className="caret" />
                      <span className="res-title">{r.title}</span>
                      {r.link && <span className="pill">link</span>}
                    </button>
                    {isOpen && (
                      <div className="res-body">
                        {r.body && <RichText text={r.body} />}
                        {r.link && (
                          <a
                            className="btn sm"
                            href={r.link}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open link ↗
                          </a>
                        )}
                        {isCoach && (
                          <div className="res-actions">
                            <button
                              className="btn sm ghost"
                              onClick={() => setEditing(r)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn sm danger"
                              onClick={() => remove(r)}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
          </div>
        </section>
      ))}

      {editing && (
        <ResourceEditor
          resource={editing === "new" ? null : editing}
          categories={[...new Set(rows.map((r) => r.category).filter(Boolean))]}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            await mutate();
            setEditing(null);
            show(msg);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ResourceEditor({
  resource,
  categories,
  onClose,
  onSaved,
}: {
  resource: Resource | null;
  categories: string[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [title, setTitle] = useState(resource?.title ?? "");
  const [category, setCategory] = useState(resource?.category ?? "");
  const [body, setBody] = useState(resource?.body ?? "");
  const [link, setLink] = useState(resource?.link ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const payload = { title, category, body, link: link.trim() || null };
      if (resource) await api(`/api/resources/${resource.id}`, "PATCH", payload);
      else await api("/api/resources", "POST", payload);
      onSaved(resource ? "Saved" : "Resource added");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't save that");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">
            {resource ? "Edit resource" : "New resource"}
          </span>
          <span className="modal-sub" />
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="customize">
          <label className="field">
            <span>Title</span>
            <input
              className="tin"
              autoFocus
              placeholder="e.g. Pull-Down Warm-Up"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Category</span>
            <input
              className="tin"
              list="res-cats"
              placeholder="e.g. Throwing, Recovery, Lifting"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <datalist id="res-cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <label className="field">
            <span>Instructions</span>
            <textarea
              className="res-editor"
              placeholder={"## Section heading\n- a step\n- another step\n\n**Bold** for emphasis. Paste a video URL and it becomes a link."}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <span className="cz-note">
              <b>## </b> makes a heading, <b>- </b> makes a bullet,{" "}
              <b>**bold**</b> for emphasis. Links are detected automatically.
            </span>
          </label>

          <label className="field">
            <span>Video or document link (optional)</span>
            <input
              className="tin"
              placeholder="https://…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </label>

          {err && (
            <p className="form-error" role="alert">
              {err}
            </p>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn primary"
              disabled={!title.trim() || busy}
              onClick={save}
            >
              {busy ? "Saving…" : resource ? "Save changes" : "Add resource"}
            </button>
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
