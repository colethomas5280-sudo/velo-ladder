"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { Athlete, TrainingSession, TrackerId } from "@/lib/types";
import {
  TRACKERS,
  TRACKER_IDS,
  gid,
  todayISO,
  throwsFromDraft,
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
import EntryForm from "./EntryForm";
import ProgressChart from "./ProgressChart";
import HistoryTable from "./HistoryTable";

const TRACKER_KEY = "veloladder:tracker";

type Me = { role: "coach" | "athlete" | "none"; athleteId: string | null };

export default function AthleteProfile({ athleteId }: { athleteId: string }) {
  const { data: me } = useSWR<Me>("/api/me", fetcher);
  const {
    data: athlete,
    error: athleteError,
    isLoading: athleteLoading,
  } = useSWR<Athlete>(`/api/athletes/${athleteId}`, fetcher);
  const isSelf = me?.role === "athlete" && me.athleteId === athleteId;
  const canManage = me?.role === "coach";
  const {
    data: sessionsData,
    mutate: mutateSessions,
    isLoading: sessionsLoading,
  } = useSWR<TrainingSession[]>(`/api/athletes/${athleteId}/sessions`, fetcher);
  const allSessions = useMemo(() => sessionsData ?? [], [sessionsData]);

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
    setDraftState(loadDraft(athleteId, tracker));
  }, [athleteId, tracker]);
  const setDraft = (next: Draft) => {
    setDraftState(next);
    saveDraft(athleteId, tracker, next);
  };

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [chartGroup, setChartGroup] =
    useState<Partial<Record<TrackerId, string>>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  const err = (e: unknown, fallback: string) =>
    showToast(e instanceof ApiError ? e.message : fallback);

  async function saveSession() {
    const { throws, hasHundred } = throwsFromDraft(
      draft.throws,
      cfg.slots.map((s) => s.key),
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
        throws: padThrows(throws),
      };
      if (draft.editingId)
        await api(`/api/sessions/${draft.editingId}`, "PATCH", payload);
      else await api(`/api/athletes/${athleteId}/sessions`, "POST", payload);
      clearDraft(athleteId, tracker);
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
      throws[k] = [0, 1, 2, 3].map((i) => (arr[i] == null ? "" : String(arr[i])));
    }
    setDraft({ date: s.date, notes: s.notes, throws, editingId: s.id });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteSession(s: TrainingSession) {
    if (!confirm("Delete this session?")) return;
    try {
      await api(`/api/sessions/${s.id}`, "DELETE");
      if (draft.editingId === s.id) {
        clearDraft(athleteId, tracker);
        setDraftState(emptyDraft());
      }
      await mutateSessions();
      showToast("Session deleted");
    } catch (e) {
      err(e, "Couldn't delete the session");
    }
  }

  function clearOrCancel() {
    clearDraft(athleteId, tracker);
    setDraftState(emptyDraft());
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

  async function changePassword(pw: string) {
    try {
      await api(`/api/athletes/${athleteId}`, "PATCH", { password: pw });
      showToast("Password updated");
    } catch (e) {
      err(e, "Couldn't update password");
    }
  }

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  if (athleteError) {
    return (
      <div className="card pad empty">
        <h3>Can&rsquo;t open this athlete</h3>
        <p>
          It may have been removed, or you don&rsquo;t have access.{" "}
          <a href="/">Back to Athletes</a>
        </p>
      </div>
    );
  }
  if (!athlete || athleteLoading) {
    return (
      <div className="card pad" style={{ color: "var(--ink-dim)" }}>
        Loading…
      </div>
    );
  }

  const groupId = chartGroup[tracker] ?? gid(cfg.groups[0]);

  return (
    <>
      <div
        className="appbar"
        style={{ position: "static", margin: "0 0 18px" }}
      >
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

      {(isSelf || canManage) && (
        <PasswordBox
          label={isSelf ? "Change my password" : "Reset this athlete's password"}
          onSave={changePassword}
        />
      )}

      <EntryForm
        cfg={cfg}
        trackerId={tracker}
        sessions={allSessions}
        draft={draft}
        setDraft={setDraft}
        onSave={saveSession}
        onClear={clearOrCancel}
        saving={saving}
        readOnly={false}
      />

      <ProgressChart
        cfg={cfg}
        trackerId={tracker}
        sessions={allSessions}
        groupId={groupId}
        setGroupId={(id) => setChartGroup((p) => ({ ...p, [tracker]: id }))}
      />

      {sessionsLoading ? (
        <div
          className="card pad"
          style={{ marginTop: 16, color: "var(--ink-dim)" }}
        >
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
          readOnly={false}
        />
      )}

      <div className="foot">
        PR = best single 100% throw · Avg = mean of all 100% throws · Floor =
        lowest 100% throw
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

/** Server requires every stored slot to be a length-4 array. */
function padThrows(throws: Record<string, (number | null)[]>) {
  const out: Record<string, (number | null)[]> = {};
  for (const [k, arr] of Object.entries(throws)) {
    out[k] = [0, 1, 2, 3].map((i) => arr[i] ?? null);
  }
  return out;
}

function PasswordBox({
  label,
  onSave,
}: {
  label: string;
  onSave: (pw: string) => Promise<void>;
}) {
  const [pw, setPw] = useState("");
  const [done, setDone] = useState(false);
  return (
    <details className="roster-d">
      <summary>{label}</summary>
      <div
        className="roster"
        style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
      >
        <input
          className="tin"
          type="text"
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
