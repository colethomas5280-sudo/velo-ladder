"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { TrainingSession } from "@/lib/types";
import {
  TRACKERS,
  num,
  todayISO,
  throwsFromDraft,
  BOX_INDEXES,
} from "@/lib/velo";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import {
  type Draft,
  emptyDraft,
  loadDraft,
  saveDraft,
  clearDraft,
} from "@/lib/draft";
import { useTracker } from "./useTracker";
import EntryForm from "./EntryForm";
import GroupEntryModal from "./GroupEntryModal";


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

  /*
   * Who the coach picked, and who is actually showing. Kept apart on purpose:
   * an athlete can leave the group while selected, and correcting that in an
   * effect renders one frame pointing at someone who is no longer there.
   * Deriving it instead means that frame never exists.
   */
  const [picked, setActiveId] = useState<string>("");
  const activeId = members.some((m) => m.id === picked)
    ? picked
    : (members[0]?.id ?? "");

  const [tracker, setTracker] = useTracker();
  const cfg = TRACKERS[tracker];

  const [draft, setDraftState] = useState<Draft>(emptyDraft());
  /*
   * Load the saved draft for whichever athlete + tracker is showing. A real
   * effect rather than a `useSyncExternalStore` read: the draft is rewritten
   * on every keystroke, and a snapshot function has to return a stable object
   * identity, which a freshly parsed draft never can.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  function memberStatus(id: string): "saved" | "data" | "empty" {
    const d = id === activeId ? draft : loadDraft(id, tracker);
    const has = cfg.slots.some((sl) => {
      const t = d.throws[sl.key] || [];
      return BOX_INDEXES.slice(1).some((i) => num(t[i]));
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
    setSaveError(null);
    try {
      const ok = await postFor(activeId, loadDraft(activeId, tracker));
      if (!ok) {
        setSaveError(
          "Enter at least one 100% throw (boxes 1-4) before saving.",
        );
        return;
      }
      setSaved((s) => new Set(s).add(activeId));
      setDraftState(emptyDraft());
      onSaved?.();
      showToast("Saved");
    } catch (e) {
      console.error("[velo] group save failed", e);
      setSaveError(
        e instanceof ApiError
          ? `Couldn't save (${e.status}): ${e.message}`
          : "Couldn't save — check your connection. Your numbers are still here.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveAll() {
    if (activeId) saveDraft(activeId, tracker, draft);
    setSaving(true);
    setSaveError(null);
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
      if (count) showToast(`Saved ${count} session${count === 1 ? "" : "s"}`);
      else
        setSaveError(
          "Nothing to save — enter at least one 100% throw for someone first.",
        );
    } catch (e) {
      console.error("[velo] group save failed", e);
      setSaveError(
        e instanceof ApiError
          ? `Couldn't save (${e.status}): ${e.message}`
          : "Couldn't save the group — check your connection. Your numbers are still here.",
      );
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
      onPick={(id) => {
        setSaveError(null);
        setActiveId(id);
      }}
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
        error={saveError}
      />
      {toast && <div className="toast">{toast}</div>}
    </GroupEntryModal>
  );
}

function pad(throws: Record<string, (number | null)[]>) {
  const out: Record<string, (number | null)[]> = {};
  for (const [k, arr] of Object.entries(throws))
    out[k] = BOX_INDEXES.map((i) => arr[i] ?? null);
  return out;
}
