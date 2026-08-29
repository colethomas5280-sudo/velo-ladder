"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { Athlete, TrainingSession, TrackerId, Throws } from "@/lib/types";
import {
  TRACKERS,
  TRACKER_IDS,
  gid,
  num,
  todayISO,
  sessionsToCsv,
} from "@/lib/velo";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import {
  type Draft,
  emptyDraft,
  loadDraft,
  saveDraft,
  clearDraft,
} from "@/lib/draft";
import Masthead from "./Masthead";
import RosterManager from "./RosterManager";
import EntryForm from "./EntryForm";
import RecordsPanel from "./RecordsPanel";
import ProgressChart from "./ProgressChart";
import HistoryTable from "./HistoryTable";

const TRACKER_KEY = "veloladder:tracker";

export default function Tracker({ role }: { role: "coach" | "athlete" }) {
  const isCoach = role === "coach";
  const readOnly = false; // athletes can log their own; coach logs anyone's

  const {
    data: athletesData,
    mutate: mutateAthletes,
    isLoading: athletesLoading,
  } = useSWR<Athlete[]>("/api/athletes", fetcher);
  const athletes = useMemo(() => athletesData ?? [], [athletesData]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!athletes.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !athletes.some((a) => a.id === selectedId)) {
      setSelectedId(athletes[0].id);
    }
  }, [athletes, selectedId]);

  const athlete = athletes.find((a) => a.id === selectedId) ?? null;

  const sessionsKey = selectedId
    ? `/api/athletes/${selectedId}/sessions`
    : null;
  const {
    data: sessions,
    mutate: mutateSessions,
    isLoading: sessionsLoading,
  } = useSWR<TrainingSession[]>(sessionsKey, fetcher);
  const allSessions = useMemo(() => sessions ?? [], [sessions]);

  const [tracker, setTrackerState] = useState<TrackerId>("mound");
  useEffect(() => {
    const saved = window.localStorage.getItem(TRACKER_KEY);
    if (saved === "mound" || saved === "pulldown") setTrackerState(saved);
  }, []);
  const setTracker = (t: TrackerId) => {
    setTrackerState(t);
    window.localStorage.setItem(TRACKER_KEY, t);
  };
  const cfg = TRACKERS[tracker];

  const [draft, setDraftState] = useState<Draft>(emptyDraft());
  useEffect(() => {
    if (selectedId) setDraftState(loadDraft(selectedId, tracker));
    else setDraftState(emptyDraft());
  }, [selectedId, tracker]);
  const setDraft = (next: Draft) => {
    setDraftState(next);
    if (selectedId) saveDraft(selectedId, tracker, next);
  };

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [chartGroup, setChartGroup] = useState<Partial<Record<TrackerId, string>>>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2800);
  };
  const err = (e: unknown, fallback: string) =>
    showToast(e instanceof ApiError ? e.message : fallback);

  /* ---------------- session mutations ---------------- */

  async function saveSession() {
    if (!athlete) return;
    const throws: Throws = {};
    for (const sl of cfg.slots) {
      const raw = draft.throws[sl.key];
      if (!raw) continue;
      const arr = [0, 1, 2, 3].map((i) => num(raw[i]));
      if (arr.some((v) => v != null)) throws[sl.key] = arr;
    }
    const hasHundred = Object.values(throws).some((a) =>
      a.slice(1).some((v) => v != null),
    );
    if (!hasHundred) {
      showToast("Enter at least one 100% throw before saving");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        type: tracker,
        date: draft.date || todayISO(),
        notes: draft.notes.trim(),
        throws: padThrows(throws, cfg.slots.map((s) => s.key)),
      };
      if (draft.editingId) {
        await api(`/api/sessions/${draft.editingId}`, "PATCH", payload);
      } else {
        await api(`/api/athletes/${athlete.id}/sessions`, "POST", payload);
      }
      clearDraft(athlete.id, tracker);
      setDraftState(emptyDraft());
      await mutateSessions();
      showToast(draft.editingId ? "Session updated" : "Session saved");
    } catch (e) {
      err(e, "Couldn't save the session");
    } finally {
      setSaving(false);
    }
  }

  function editSession(s: TrainingSession) {
    const throws: Record<string, string[]> = {};
    for (const [k, arr] of Object.entries(s.throws)) {
      throws[k] = [0, 1, 2, 3].map((i) =>
        arr[i] == null ? "" : String(arr[i]),
      );
    }
    setDraft({ date: s.date, notes: s.notes, throws, editingId: s.id });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteSession(s: TrainingSession) {
    if (!confirm("Delete this session?")) return;
    try {
      await api(`/api/sessions/${s.id}`, "DELETE");
      if (draft.editingId === s.id) {
        clearDraft(s.athleteId, tracker);
        setDraftState(emptyDraft());
      }
      await mutateSessions();
      showToast("Session deleted");
    } catch (e) {
      err(e, "Couldn't delete the session");
    }
  }

  function clearOrCancel() {
    if (athlete) clearDraft(athlete.id, tracker);
    setDraftState(emptyDraft());
  }

  /* ---------------- roster mutations ---------------- */

  async function addAthlete(name: string, emailStr: string, password: string) {
    try {
      const created = await api<Athlete>("/api/athletes", "POST", {
        name,
        inviteEmail: emailStr || null,
        password: password || null,
      });
      await mutateAthletes();
      setSelectedId(created.id);
      showToast(`Added ${name}`);
    } catch (e) {
      err(e, "Couldn't add athlete");
    }
  }
  async function updateAthlete(
    id: string,
    patch: Partial<Athlete> & { password?: string },
  ) {
    try {
      await api(`/api/athletes/${id}`, "PATCH", patch);
      await mutateAthletes();
      if (patch.password) showToast("Password updated");
    } catch (e) {
      err(e, "Couldn't update athlete");
    }
  }
  async function archiveAthlete(a: Athlete) {
    try {
      await api(`/api/athletes/${a.id}`, "DELETE");
      await mutateAthletes();
      showToast(`Removed ${a.name}`);
    } catch (e) {
      err(e, "Couldn't remove athlete");
    }
  }

  function exportCsv() {
    if (!athlete) return;
    const csv = sessionsToCsv(athlete.name, allSessions);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      athlete.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "-velo.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  /* ---------------- render ---------------- */

  if (athletesLoading && athletes.length === 0) {
    return (
      <div className="card pad" style={{ color: "var(--ink-dim)" }}>
        Loading roster…
      </div>
    );
  }

  if (isCoach && athletes.length === 0) {
    return (
      <div className="card pad empty">
        <div className="eyebrow">Velocity development</div>
        <h3>Build your roster</h3>
        <p>
          Add your first athlete with an email and a password. Give them those
          two things and they sign in to their own tracker.
        </p>
        <RosterManager
          athletes={[]}
          onAdd={addAthlete}
          onUpdate={updateAthlete}
          onArchive={archiveAthlete}
        />
      </div>
    );
  }

  if (!athlete) {
    return (
      <div className="card pad empty">
        <h3>No athlete selected</h3>
      </div>
    );
  }

  const groupId = chartGroup[tracker] ?? gid(cfg.groups[0]);

  return (
    <>
      <div className="appbar" style={{ position: "static", margin: "0 0 20px" }}>
        {isCoach ? (
          <select
            value={selectedId ?? ""}
            aria-label="Select athlete"
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {athletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="mark" style={{ fontSize: 16 }}>
            {athlete.name}
          </span>
        )}
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Tracker">
          {TRACKER_IDS.map((t) => (
            <button
              key={t}
              aria-pressed={tracker === t}
              onClick={() => setTracker(t)}
            >
              {TRACKERS[t].label}
            </button>
          ))}
        </div>
      </div>

      <Masthead athlete={athlete} sessions={allSessions} />

      {isCoach ? (
        <RosterManager
          athletes={athletes}
          onAdd={addAthlete}
          onUpdate={updateAthlete}
          onArchive={archiveAthlete}
        />
      ) : (
        <AthleteAccount
          onSave={(pw) => updateAthlete(athlete.id, { password: pw })}
        />
      )}

      <div className="grid-main">
        <EntryForm
          cfg={cfg}
          trackerId={tracker}
          sessions={allSessions}
          draft={draft}
          setDraft={setDraft}
          onSave={saveSession}
          onClear={clearOrCancel}
          saving={saving}
          readOnly={readOnly}
        />
        <RecordsPanel cfg={cfg} trackerId={tracker} sessions={allSessions} />
      </div>

      <ProgressChart
        cfg={cfg}
        trackerId={tracker}
        sessions={allSessions}
        groupId={groupId}
        setGroupId={(id) => setChartGroup((p) => ({ ...p, [tracker]: id }))}
      />

      {sessionsLoading ? (
        <div className="card pad" style={{ marginTop: 16, color: "var(--ink-dim)" }}>
          Loading sessions…
        </div>
      ) : (
        <HistoryTable
          cfg={cfg}
          trackerId={tracker}
          sessions={allSessions}
          expanded={expanded}
          toggle={toggleExpand}
          onEdit={editSession}
          onDelete={deleteSession}
          onExport={exportCsv}
          readOnly={readOnly}
        />
      )}

      <div className="foot">
        Velo Ladder · synced across devices
        <br />
        PR = best single 100% throw · Avg = mean of all 100% throws · Floor =
        lowest 100% throw
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

/** Ensure every stored slot is a length-4 array (server requires it). */
function padThrows(throws: Throws, _keys: string[]): Throws {
  const out: Throws = {};
  for (const [k, arr] of Object.entries(throws)) {
    const a = [0, 1, 2, 3].map((i) => arr[i] ?? null);
    out[k] = a;
  }
  return out;
}

function AthleteAccount({ onSave }: { onSave: (pw: string) => Promise<void> }) {
  const [pw, setPw] = useState("");
  const [done, setDone] = useState(false);
  return (
    <details className="roster-d">
      <summary>Change my password</summary>
      <div
        className="roster"
        style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
      >
        <input
          className="tin"
          type="password"
          placeholder="new password (min 6)"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setDone(false);
          }}
        />
        <button
          className="btn sm primary"
          disabled={pw.length < 6}
          onClick={async () => {
            await onSave(pw);
            setPw("");
            setDone(true);
          }}
        >
          Save
        </button>
        {done && (
          <span style={{ color: "var(--good)", fontSize: 12 }}>Saved</span>
        )}
      </div>
    </details>
  );
}

