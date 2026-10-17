"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  summarizeDraft,
  sessionTitle,
  sessionLine,
  groupTitle,
  groupLine,
} from "@/lib/saveSummary";
import { useTracker } from "./useTracker";
import EntryForm from "./EntryForm";
import GroupEntryModal from "./GroupEntryModal";
import ConfirmDialog from "./ConfirmDialog";

/** What the save confirm is showing. Built when Save is pressed, so it cannot drift while it is open. */
type Pending = {
  kind: "one" | "all";
  title: string;
  /** One line for a single athlete, one per athlete for Save all. */
  lines: string[];
  confirmLabel: string;
};

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
  const [pending, setPending] = useState<Pending | null>(null);
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

  /*
   * The Save buttons only ASK. Each request step runs the same "is there
   * anything to save" check the save itself does, then opens the confirm; the
   * real save (saveOne / saveAll below) runs from the confirm's own button.
   * The summary is built from the same drafts the post will use: the active
   * athlete's in-memory draft, everyone else's stored one.
   */
  function requestSaveOne() {
    if (!activeId) return;
    const summary = summarizeDraft(draft, tracker);
    if (!summary) {
      setSaveError("Enter at least one 100% throw (boxes 1-4) before saving.");
      return;
    }
    const name = members.find((m) => m.id === activeId)?.name ?? "";
    setPending({
      kind: "one",
      title: sessionTitle(name, summary.editing),
      lines: [sessionLine(summary)],
      confirmLabel: summary.editing ? "Update" : "Save",
    });
  }

  function requestSaveAll() {
    const rows = members.flatMap((m) => {
      const d = m.id === activeId ? draft : loadDraft(m.id, tracker);
      const summary = summarizeDraft(d, tracker);
      return summary ? [groupLine(m.name, summary)] : [];
    });
    if (rows.length === 0) {
      setSaveError(
        "Nothing to save. Enter at least one 100% throw for someone first.",
      );
      return;
    }
    setPending({
      kind: "all",
      title: groupTitle(rows.length),
      lines: rows,
      confirmLabel: "Save all",
    });
  }

  /** Set the instant a confirm is accepted. `saving` alone is a render behind a fast double click. */
  const confirming = useRef(false);
  async function confirmSave() {
    if (!pending || confirming.current) return;
    confirming.current = true;
    try {
      if (pending.kind === "one") await saveOne();
      else await saveAll();
    } finally {
      confirming.current = false;
      setPending(null);
    }
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
          : "Couldn't save. Check your connection. Your numbers are still here.",
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
          /*
           * Record every success the moment it happens, not after the loop.
           * postFor has just cleared this athlete's STORED draft; if a later
           * athlete then fails, an unrecorded success leaves the active
           * athlete's on-screen numbers behind, and the retry writes them back
           * to storage and posts the same session a second time.
           */
          setSaved(new Set(now));
          if (m.id === activeId) setDraftState(emptyDraft());
        }
      }
      setSaved(now);
      setDraftState(emptyDraft());
      onSaved?.();
      if (count) showToast(`Saved ${count} session${count === 1 ? "" : "s"}`);
      else
        setSaveError(
          "Nothing to save. Enter at least one 100% throw for someone first.",
        );
    } catch (e) {
      console.error("[velo] group save failed", e);
      const why =
        e instanceof ApiError
          ? `Couldn't save (${e.status}): ${e.message}`
          : "Couldn't save the group. Check your connection. Your numbers are still here.";
      // Some sessions may already exist: say so, and tell the page, so the
      // roster is not left showing the old picture.
      setSaveError(count > 0 ? `Saved ${count}, but not everyone. ${why}` : why);
      if (count > 0) onSaved?.();
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
      overlay={
        pending && (
          <ConfirmDialog
            title={pending.title}
            confirmLabel={pending.confirmLabel}
            cancelLabel="Keep editing"
            onConfirm={confirmSave}
            onCancel={() => setPending(null)}
            busy={saving}
          >
            {pending.kind === "one" ? (
              <p>{pending.lines[0]}</p>
            ) : (
              <ul className="confirm-lines">
                {pending.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
          </ConfirmDialog>
        )
      }
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
        onSave={requestSaveOne}
        onClear={clearActive}
        saving={saving}
        readOnly={false}
        groupSize={members.length}
        onSaveAll={requestSaveAll}
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
