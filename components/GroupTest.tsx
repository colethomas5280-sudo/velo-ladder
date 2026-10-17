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
  // One tab per distinct, known athlete. A repeated id or an id with no
  // matching person is skipped rather than rendered twice or crashing.
  const members = [...new Set(ids)]
    .map((id) => people.find((p) => p.id === id))
    .filter(Boolean) as Person[];

  const [pickedId, setActiveId] = useState(members[0]?.id ?? "");
  // Derived every render: if the picked athlete has gone (or never arrived),
  // fall back to the first one rather than leaving every panel hidden.
  const activeId = members.some((m) => m.id === pickedId)
    ? pickedId
    : (members[0]?.id ?? "");
  // Mounted panels: the first tab, plus anyone who already has a draft.
  const [mounted, setMounted] = useState<Set<string>>(
    () =>
      new Set(
        members
          .filter((m, i) => i === 0 || hasTestDraft(type, m.id))
          .map((m) => m.id),
      ),
  );
  // Who had a draft when the screen opened. Their tab shows a dot from the
  // start, even while their records are still loading and their form has not
  // yet reported (the Save all count still waits for the form).
  const [hadDraft] = useState<Set<string>>(
    () => new Set(members.filter((m) => hasTestDraft(type, m.id)).map((m) => m.id)),
  );
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const saves = useRef<Map<string, () => Promise<boolean>>>(new Map());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // False once the screen is closed, so a save that finishes afterwards
  // neither updates state nor arms a timer that nothing will clear.
  const alive = useRef(true);

  const show = (m: string) => {
    if (!alive.current) return;
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

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

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
    let firstFailed: string | null = null;
    let failed = 0;
    for (const id of dirtyIds) {
      const save = saves.current.get(id);
      if (!save) continue;
      if (await save()) ok += 1;
      else {
        failed += 1;
        firstFailed ??= id;
      }
    }
    if (!alive.current) return;
    setBusy(false);
    const noun = LABEL[type].noun;
    show(
      failed
        ? `Saved ${ok}, ${failed} failed`
        : `Saved ${ok} ${noun}${ok === 1 ? "" : "s"}`,
    );
    // Bring the first failure to the front so its error is on screen.
    if (firstFailed) pick(firstFailed);
  }

  // Tab text: first names, plus the last initial when two picked athletes
  // share one (and the full name if even that is not enough).
  const firstOf = (n: string) => n.trim().split(/\s+/)[0];
  const labelFor = new Map<string, string>();
  for (const m of members) {
    const clash = members.filter(
      (o) => firstOf(o.name).toLowerCase() === firstOf(m.name).toLowerCase(),
    );
    let label = firstOf(m.name);
    if (clash.length > 1) {
      const words = m.name.trim().split(/\s+/);
      const initial = words.length > 1 ? words[words.length - 1][0] : "";
      label = initial ? `${label} ${initial.toUpperCase()}.` : m.name.trim();
    }
    labelFor.set(m.id, label);
  }
  for (const m of members) {
    const same = members.filter((o) => labelFor.get(o.id) === labelFor.get(m.id));
    if (same.length > 1) labelFor.set(m.id, m.name.trim());
  }
  const active = members.find((m) => m.id === activeId);

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

        {members.length === 0 ? (
          <div className="modal-body">
            <p style={{ color: "var(--ink-dim)", padding: 16 }}>No athletes to show.</p>
          </div>
        ) : (
          <>
            <div className="tabstrip modal-tabs">
              {members.map((m) => {
                const isDirty = dirty[m.id] ?? hadDraft.has(m.id);
                const status = isDirty ? "data" : saved.has(m.id) ? "saved" : "empty";
                return (
                  <button
                    key={m.id}
                    className={`atab ${status}${m.id === activeId ? " on" : ""}`}
                    aria-label={
                      status === "data"
                        ? `${m.name}, unsaved answers`
                        : status === "saved"
                          ? `${m.name}, saved`
                          : m.name
                    }
                    aria-pressed={m.id === activeId}
                    onClick={() => pick(m.id)}
                  >
                    {labelFor.get(m.id)}
                    {status !== "empty" && (
                      <span aria-hidden="true">{status === "saved" ? " ✓" : " ●"}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="modal-body">
              {active && (
                <div className="group-test-name" role="heading" aria-level={3}>
                  {active.name}
                </div>
              )}
              {members.map((m) =>
                mounted.has(m.id) || m.id === activeId ? (
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
          </>
        )}

        {members.length > 0 && (
          <div className="ms-actions group-test-foot">
            <button
              className="btn primary"
              disabled={busy || dirtyIds.length === 0}
              onClick={saveAll}
            >
              {busy ? "Saving…" : `Save all (${dirtyIds.length})`}
            </button>
          </div>
        )}
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
  const { data, error, isValidating, mutate } = useSWR<(MovementScreen | DeliveryScreen)[]>(
    `/api/athletes/${athlete.id}/${path}`,
    fetcher,
  );
  const [draft] = useState(() => loadTestDraft(type, athlete.id));

  /*
   * No form until the records are here: a form mounted early would be frozen
   * on "no record today" and (with persist) would treat a restored draft as
   * stale. A failed load says so and offers a retry, so one athlete's bad
   * request never leaves a tab on "Loading" forever.
   */
  if (!data) {
    if (error && !isValidating) {
      return (
        <div style={{ padding: 16 }}>
          <p style={{ color: "var(--ink-dim)" }}>{`Couldn't load ${athlete.name}'s records.`}</p>
          <button className="btn" onClick={() => void mutate()}>
            Retry
          </button>
        </div>
      );
    }
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
