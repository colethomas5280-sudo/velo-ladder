"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { DeliveryScreen, MovementScreen } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import { todayISO } from "@/lib/velo";
import { hasTestDraft, loadTestDraft, type TestType } from "@/lib/testDraft";
import ScreenForm from "./ScreenForm";
import DeliveryForm from "./DeliveryForm";

/* ------------------------------------------------------------------ *
 * Several athletes through the same test on one device
 *
 * One tab per athlete, one form per athlete, all kept mounted once opened so
 * flipping between them never loses an answer. Unsaved answers are also kept
 * in the browser (lib/testDraft.ts), so a reload restores them, and an athlete
 * with a saved draft is mounted straight away so the tab can show its dot and
 * Save all can reach it.
 *
 * Saves are the same POSTs the one-athlete forms make; there is no new API.
 * ------------------------------------------------------------------ */

type Person = { id: string; name: string };

const LABEL: Record<TestType, { title: string; noun: string }> = {
  screen: { title: "Movement screen", noun: "screen" },
  delivery: { title: "Pitching Inhibitors", noun: "assessment" },
};

export default function GroupTest({
  type,
  people,
  ids,
  onClose,
  onSaved,
}: {
  type: TestType;
  people: Person[];
  ids: string[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const members = ids
    .map((id) => people.find((p) => p.id === id))
    .filter(Boolean) as Person[];

  const [activeId, setActiveId] = useState(members[0]?.id ?? "");
  // Mounted panels: the first tab, plus anyone who already has a draft.
  const [mounted, setMounted] = useState<Set<string>>(
    () =>
      new Set(
        members
          .filter((m, i) => i === 0 || hasTestDraft(type, m.id))
          .map((m) => m.id),
      ),
  );
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const saves = useRef<Map<string, () => Promise<boolean>>>(new Map());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const pick = (id: string) => {
    setActiveId(id);
    setMounted((s) => (s.has(id) ? s : new Set(s).add(id)));
  };

  const markDirty = useCallback((id: string, isDirty: boolean) => {
    setDirty((d) => (d[id] === isDirty ? d : { ...d, [id]: isDirty }));
  }, []);

  const afterSave = (id: string, msg: string) => {
    setSaved((s) => new Set(s).add(id));
    onSaved?.();
    show(msg);
  };

  const dirtyIds = members.filter((m) => dirty[m.id]).map((m) => m.id);

  async function saveAll() {
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const id of dirtyIds) {
      const save = saves.current.get(id);
      if (!save) continue;
      if (await save()) ok += 1;
      else failed += 1;
    }
    setBusy(false);
    const noun = LABEL[type].noun;
    show(
      failed
        ? `Saved ${ok}, ${failed} failed`
        : `Saved ${ok} ${noun}${ok === 1 ? "" : "s"}`,
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={LABEL[type].title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">{LABEL[type].title}</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="tabstrip modal-tabs">
          {members.map((m) => {
            const status = dirty[m.id] ? "data" : saved.has(m.id) ? "saved" : "empty";
            return (
              <button
                key={m.id}
                className={`atab ${status}${m.id === activeId ? " on" : ""}`}
                onClick={() => pick(m.id)}
              >
                {m.name.split(" ")[0]}
                {status === "saved" ? " ✓" : status === "data" ? " ●" : ""}
              </button>
            );
          })}
        </div>

        <div className="modal-body">
          {members.map((m) =>
            mounted.has(m.id) ? (
              <div key={m.id} data-athlete={m.id} hidden={m.id !== activeId}>
                <AthletePanel
                  type={type}
                  athlete={m}
                  onDirty={(d) => markDirty(m.id, d)}
                  register={(fn) => saves.current.set(m.id, fn)}
                  onSaved={(msg) => afterSave(m.id, msg)}
                />
              </div>
            ) : null,
          )}
        </div>

        <div className="ms-actions group-test-foot">
          <button
            className="btn primary"
            disabled={busy || dirtyIds.length === 0}
            onClick={saveAll}
          >
            {busy ? "Saving…" : `Save all (${dirtyIds.length})`}
          </button>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/**
 * One athlete's form. Loads their records first (the same call their own page
 * makes), works out today's record and any draft ONCE, then mounts the form
 * and never re-derives them: later revalidation must not reset what the coach
 * is in the middle of typing.
 */
function AthletePanel({
  type,
  athlete,
  onDirty,
  register,
  onSaved,
}: {
  type: TestType;
  athlete: Person;
  onDirty: (dirty: boolean) => void;
  register: (save: () => Promise<boolean>) => void;
  onSaved: (msg: string) => void;
}) {
  const path = type === "screen" ? "screens" : "delivery";
  const { data, mutate } = useSWR<(MovementScreen | DeliveryScreen)[]>(
    `/api/athletes/${athlete.id}/${path}`,
    fetcher,
  );
  const [draft] = useState(() => loadTestDraft(type, athlete.id));

  if (!data) {
    return <p style={{ color: "var(--ink-dim)", padding: 16 }}>Loading {athlete.name}…</p>;
  }

  const openingDate = draft?.date ?? todayISO();
  const initial = data.find((r) => r.date === openingDate) ?? null;
  const takenDates = data.map((r) => r.date);

  /*
   * Tell the shell FIRST, then refresh. Save all shows its summary toast once
   * every save has returned; if the shell heard about each save only after a
   * network refresh, those per-athlete toasts would land after the summary and
   * replace it.
   */
  const done = async (msg: string) => {
    onSaved(msg);
    try {
      await mutate();
    } catch {
      /* a failed refresh must never undo a save that worked */
    }
  };

  return type === "screen" ? (
    <ScreenForm
      athleteId={athlete.id}
      initial={initial as MovementScreen | null}
      takenDates={takenDates}
      group
      persist
      draft={draft}
      onDirty={onDirty}
      register={register}
      onSaved={done}
    />
  ) : (
    <DeliveryForm
      athleteId={athlete.id}
      date={openingDate}
      initial={initial as DeliveryScreen | null}
      takenDates={takenDates}
      group
      persist
      draft={draft}
      onDirty={onDirty}
      register={register}
      onSaved={done}
    />
  );
}
