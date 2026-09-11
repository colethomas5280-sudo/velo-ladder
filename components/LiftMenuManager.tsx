"use client";

import { useState } from "react";
import type { KeyedMutator } from "swr";
import { api, ApiError } from "@/lib/fetcher";
import {
  MAX_LIFT_NAME,
  METRIC_LABEL,
  type Lift,
  type LiftMode,
} from "@/lib/strength";

/* ------------------------------------------------------------------ *
 * Managing the lift menu
 *
 * Coach-only, and deliberately plain: a name, which group it sits under, and
 * whether it is loaded or bodyweight. That third one is the only choice with
 * teeth — it decides whether the lift is read in pounds or in reps — so it is
 * spelled out rather than left to a jargon label.
 *
 * Removing archives. A lift with sessions behind it cannot be deleted without
 * orphaning them, and one without is cheap to keep, so there is no hard
 * delete to explain the difference between.
 * ------------------------------------------------------------------ */

const MODE_HELP: Record<LiftMode, string> = {
  load: "Weight on the bar — tracked as an estimated 1RM",
  reps: "Bodyweight — tracked as reps, with any added load noted",
};

interface Draft {
  name: string;
  group: string;
  mode: LiftMode;
  help: string;
}

const emptyDraft = (group = ""): Draft => ({
  name: "",
  group,
  mode: "load",
  help: "",
});

export default function LiftMenuManager({
  lifts,
  mutate,
}: {
  /** Every lift, archived included — the archived ones are listed separately. */
  lifts: Lift[];
  mutate: KeyedMutator<Lift[]>;
}) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const live = lifts.filter((l) => !l.archived);
  const retired = lifts.filter((l) => l.archived);
  const groups = [...new Set(live.map((l) => l.group).filter(Boolean))];

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await mutate();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't save that.");
    }
    setBusy(false);
  }

  const add = () =>
    run(async () => {
      await api("/api/lifts", "POST", draft);
      setDraft(emptyDraft(draft.group));
    });

  const patch = (key: string, body: Partial<Lift>) =>
    run(() => api(`/api/lifts/${encodeURIComponent(key)}`, "PATCH", body));

  const retire = (l: Lift) =>
    run(async () => {
      if (
        !confirm(
          `Take ${l.name} off the menu? Sessions already logged against it keep it.`,
        )
      )
        return;
      await api(`/api/lifts/${encodeURIComponent(l.key)}`, "DELETE");
    });

  /*
   * Reordering by swapping positions with the neighbour, rather than by drag.
   * A dozen rows on a phone in a weight room is not a drag-and-drop problem.
   */
  const move = (i: number, by: number) => {
    const other = live[i + by];
    const self = live[i];
    if (!other) return;
    run(async () => {
      await api(`/api/lifts/${encodeURIComponent(self.key)}`, "PATCH", {
        position: other.position,
      });
      await api(`/api/lifts/${encodeURIComponent(other.key)}`, "PATCH", {
        position: self.position,
      });
    });
  };

  return (
    <details className="roster-d lmm">
      <summary>Manage lifts ({live.length})</summary>

      {err != null && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      <ul className="lmm-list">
        {live.map((l, i) => (
          <li key={l.key}>
            {editing === l.key ? (
              <LiftEditor
                lift={l}
                groups={groups}
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={async (body) => {
                  await patch(l.key, body);
                  setEditing(null);
                }}
              />
            ) : (
              <div className="lmm-row">
                <span className="lmm-name">
                  {l.name}
                  {l.group && <em>{l.group}</em>}
                </span>
                <span className="lmm-mode">{METRIC_LABEL[l.mode]}</span>
                <span className="row-actions">
                  <button
                    className="btn sm ghost"
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={`Move ${l.name} up`}
                  >
                    ↑
                  </button>
                  <button
                    className="btn sm ghost"
                    disabled={busy || i === live.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`Move ${l.name} down`}
                  >
                    ↓
                  </button>
                  <button className="btn sm ghost" onClick={() => setEditing(l.key)}>
                    Edit
                  </button>
                  <button
                    className="btn sm danger"
                    disabled={busy}
                    onClick={() => retire(l)}
                  >
                    Remove
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="lmm-add">
        <div className="eyebrow">Add a lift</div>
        <div className="lmm-fields">
          <label className="field">
            <span>Name</span>
            <input
              value={draft.name}
              maxLength={MAX_LIFT_NAME}
              placeholder="Trap bar deadlift"
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Group</span>
            <input
              value={draft.group}
              list="lift-groups"
              placeholder="Lower body"
              onChange={(e) => setDraft((p) => ({ ...p, group: e.target.value }))}
            />
          </label>
        </div>
        <datalist id="lift-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <ModePicker
          mode={draft.mode}
          onChange={(mode) => setDraft((p) => ({ ...p, mode }))}
        />
        <label className="field">
          <span>Note for the athlete (optional)</span>
          <input
            value={draft.help}
            placeholder="Log one side — the load, not the total"
            onChange={(e) => setDraft((p) => ({ ...p, help: e.target.value }))}
          />
        </label>
        <button
          className="btn primary"
          disabled={busy || !draft.name.trim()}
          onClick={add}
        >
          {busy ? "Saving…" : "Add lift"}
        </button>
      </div>

      {retired.length > 0 && (
        <div className="lmm-retired">
          <div className="eyebrow">Off the menu</div>
          <ul className="lmm-list">
            {retired.map((l) => (
              <li key={l.key}>
                <div className="lmm-row">
                  <span className="lmm-name dim">{l.name}</span>
                  <span className="row-actions">
                    <button
                      className="btn sm ghost"
                      disabled={busy}
                      onClick={() => patch(l.key, { archived: false })}
                    >
                      Put back
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <p className="cz-note">
            Still named everywhere they were logged — taking a lift off the menu
            stops it being offered, it never rewrites history.
          </p>
        </div>
      )}
    </details>
  );
}

/** The one choice with teeth, spelled out rather than labelled in jargon. */
function ModePicker({
  mode,
  onChange,
  disabled,
}: {
  mode: LiftMode;
  onChange: (m: LiftMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="lmm-modes" role="group" aria-label="How it's measured">
      {(["load", "reps"] as LiftMode[]).map((m) => (
        <button
          key={m}
          className="chip lmm-mode-pick"
          aria-pressed={m === mode}
          disabled={disabled}
          onClick={() => onChange(m)}
        >
          <b>{METRIC_LABEL[m]}</b>
          <span>{MODE_HELP[m]}</span>
        </button>
      ))}
    </div>
  );
}

function LiftEditor({
  lift,
  groups,
  busy,
  onCancel,
  onSave,
}: {
  lift: Lift;
  groups: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (body: Partial<Lift>) => void;
}) {
  const [d, setD] = useState<Draft>({
    name: lift.name,
    group: lift.group,
    mode: lift.mode,
    help: lift.help,
  });

  return (
    <div className="lmm-edit">
      <div className="lmm-fields">
        <label className="field">
          <span>Name</span>
          <input
            value={d.name}
            maxLength={MAX_LIFT_NAME}
            onChange={(e) => setD((p) => ({ ...p, name: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>Group</span>
          <input
            value={d.group}
            list="lift-groups"
            onChange={(e) => setD((p) => ({ ...p, group: e.target.value }))}
          />
        </label>
      </div>
      <ModePicker mode={d.mode} onChange={(mode) => setD((p) => ({ ...p, mode }))} />
      <label className="field">
        <span>Note for the athlete (optional)</span>
        <input
          value={d.help}
          onChange={(e) => setD((p) => ({ ...p, help: e.target.value }))}
        />
      </label>
      <p className="cz-note">
        Renaming is safe — every session ever logged against this lift follows
        the new name. Changing how it&rsquo;s measured is refused once there is
        history, because it would re-read all of it.
      </p>
      <div className="lmm-actions">
        <button
          className="btn primary"
          disabled={busy || !d.name.trim()}
          onClick={() => onSave(d)}
        >
          Save
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
