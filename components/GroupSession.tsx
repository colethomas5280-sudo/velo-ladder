"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { TrainingSession, TrackerId } from "@/lib/types";
import { TRACKERS, num, todayISO, throwsFromDraft } from "@/lib/velo";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import {
  type Draft,
  emptyDraft,
  loadDraft,
  saveDraft,
  clearDraft,
} from "@/lib/draft";
import EntryForm from "./EntryForm";
import GroupEntryModal from "./GroupEntryModal";

const TRACKER_KEY = "veloladder:tracker";

export default function GroupSession({
  people,
  ids,
  onClose,
  onSaved,
}: {
  people: { id: string; name: string }[];
  ids: string[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const members = useMemo(
    () => ids.map((id) => people.find((p) => p.id === id)).filter(Boolean) as {
      id: string;
      name: string;
    }[],
    [ids, people],
  );

  const [activeId, setActiveId] = useState<string>(members[0]?.id ?? "");
  useEffect(() => {
    if (members.length && !members.some((m) => m.id === activeId))
      setActiveId(members[0].id);
  }, [members, activeId]);

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
    if (activeId) setDraftState(loadDraft(activeId, tracker));
  }, [activeId, tracker]);
  const setDraft = (next: Draft) => {
    setDraftState(next);
    if (activeId) saveDraft(activeId, tracker, next);
  };

  const { data: activeSessions } = useSWR<TrainingSession[]>(
    activeId ? `/api/athletes/${activeId}/sessions` : null,
    fetcher,
  );

  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  function memberStatus(id: string): "saved" | "data" | "empty" {
    const d = id === activeId ? draft : loadDraft(id, tracker);
    const has = cfg.slots.some((sl) => {
      const t = d.throws[sl.key] || [];
      return [1, 2, 3].some((i) => num(t[i]));
    });
    if (has) return "data";
    return saved.has(id) ? "saved" : "empty";
  }

  async function postFor(id: string, d: Draft): Promise<boolean> {
    const { throws, hasHundred } = throwsFromDraft(
      d.throws,
      cfg.slots.map((s) => s.key),
    );
    if (!hasHundred) return false;
    const payload = {
      type: tracker,
      date: d.date || todayISO(),
      notes: (d.notes || "").trim(),
      throws: pad(throws),
    };
    if (d.editingId) await api(`/api/sessions/${d.editingId}`, "PATCH", payload);
    else await api(`/api/athletes/${id}/sessions`, "POST", payload);
    clearDraft(id, tracker);
    return true;
  }

  async function saveOne() {
    if (!activeId) return;
    saveDraft(activeId, tracker, draft);
    setSaving(true);
    try {
      const ok = await postFor(activeId, loadDraft(activeId, tracker));
      if (!ok) {
        showToast("Enter at least one 100% throw first");
        return;
      }
      setSaved((s) => new Set(s).add(activeId));
      setDraftState(emptyDraft());
      onSaved?.();
      showToast("Saved");
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function saveAll() {
    if (activeId) saveDraft(activeId, tracker, draft);
    setSaving(true);
    let count = 0;
    const now = new Set(saved);
    try {
      for (const m of members) {
        if (await postFor(m.id, loadDraft(m.id, tracker))) {
          now.add(m.id);
          count++;
        }
      }
      setSaved(now);
      setDraftState(emptyDraft());
      onSaved?.();
      showToast(
        count
          ? `Saved ${count} session${count === 1 ? "" : "s"}`
          : "Nothing to save — enter some 100% throws first",
      );
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : "Couldn't save the group");
    } finally {
      setSaving(false);
    }
  }

  function clearActive() {
    if (activeId) clearDraft(activeId, tracker);
    setDraftState(emptyDraft());
  }

  const activeName = members.find((m) => m.id === activeId)?.name.split(" ")[0];

  return (
    <GroupEntryModal
      tracker={tracker}
      setTracker={setTracker}
      activeId={activeId}
      onPick={setActiveId}
      onClose={onClose}
      tabs={members.map((m) => ({
        id: m.id,
        name: m.name.split(" ")[0],
        status: memberStatus(m.id),
      }))}
    >
      <EntryForm
        cfg={cfg}
        trackerId={tracker}
        sessions={activeSessions ?? []}
        draft={draft}
        setDraft={setDraft}
        onSave={saveOne}
        onClear={clearActive}
        saving={saving}
        readOnly={false}
        groupSize={members.length}
        onSaveAll={saveAll}
        activeName={activeName}
      />
      {toast && <div className="toast">{toast}</div>}
    </GroupEntryModal>
  );
}

function pad(throws: Record<string, (number | null)[]>) {
  const out: Record<string, (number | null)[]> = {};
  for (const [k, arr] of Object.entries(throws))
    out[k] = [0, 1, 2, 3].map((i) => arr[i] ?? null);
  return out;
}
