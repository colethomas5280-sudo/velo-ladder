"use client";

import { useState } from "react";
import useSWR from "swr";
import type { Setback } from "@/lib/types";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import { EXPLAINER, type Guidance } from "@/lib/setback";
import { fmtDate } from "@/lib/velo";

interface StatusPayload {
  guidance: Guidance;
  open: Setback[];
  history: Setback[];
  cnsThresholdPct: number;
  cnsIsDefault: boolean;
}

const KIND_LABEL: Record<Setback["kind"], string> = {
  soreness: "Soreness",
  cns: "CNS readiness",
  injury: "Reported pain",
};

export default function GuidanceCard({
  athleteId,
  isCoach,
}: {
  athleteId: string;
  isCoach: boolean;
}) {
  const { data, mutate } = useSWR<StatusPayload>(
    `/api/athletes/${athleteId}/status`,
    fetcher,
  );
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [bandOpen, setBandOpen] = useState(false);
  const [band, setBand] = useState("");

  if (!data) return null;
  const g = data.guidance;

  async function review(s: Setback) {
    setBusy(s.id);
    try {
      await api(`/api/setbacks/${s.id}`, "PATCH");
      await mutate();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Couldn't mark that reviewed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`card pad guidance g-${g.level}`}>
      <div className="g-head">
        <span className="g-dot" />
        <div>
          <h3>{g.title}</h3>
          <p>{g.body}</p>
        </div>
      </div>

      {data.open.length > 0 && (
        <ul className="g-flags">
          {data.open.map((s) => (
            <li key={s.id}>
              <span className={`pill ${s.kind === "injury" ? "warn" : ""}`}>
                {KIND_LABEL[s.kind]}
              </span>
              <span className="g-detail">{s.detail}</span>
              <span className="g-since">since {fmtDate(s.openedOn)}</span>
              {isCoach && (
                <button
                  className="btn sm ghost"
                  disabled={busy === s.id}
                  onClick={() => review(s)}
                >
                  {busy === s.id ? "…" : "Mark reviewed"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isCoach && data.open.some((s) => s.kind === "injury") && (
        <p className="cz-note g-note">
          A pain flag never clears itself. Once it&rsquo;s been looked at, mark
          it reviewed to put them back on a normal track.
        </p>
      )}

      {isCoach && (
        <div className="g-band">
          {bandOpen ? (
            <>
              <span>Flag a max day this far under his 30-day average:</span>
              <input
                className="tin"
                inputMode="decimal"
                autoFocus
                style={{ width: 68 }}
                placeholder={String(data.cnsThresholdPct)}
                value={band}
                onChange={(e) =>
                  setBand(e.target.value.replace(/[^0-9.]/g, ""))
                }
              />
              <span>%</span>
              <button
                className="btn sm primary"
                onClick={async () => {
                  await api(`/api/athletes/${athleteId}`, "PATCH", {
                    cnsThresholdPct: band.trim() === "" ? null : Number(band),
                  });
                  await mutate();
                  setBandOpen(false);
                  setBand("");
                }}
              >
                Save
              </button>
              <button
                className="btn sm ghost"
                onClick={() => {
                  setBandOpen(false);
                  setBand("");
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span>
                CNS band <b>{data.cnsThresholdPct}%</b>
                {data.cnsIsDefault ? " (facility default)" : " (set for him)"}
              </span>
              <button
                className="btn sm ghost"
                onClick={() => setBandOpen(true)}
              >
                Tune
              </button>
            </>
          )}
        </div>
      )}

      <button
        className="g-explain-toggle"
        onClick={() => setExplainerOpen((v) => !v)}
        aria-expanded={explainerOpen}
      >
        <span className="caret" />
        {EXPLAINER.title}
      </button>

      {explainerOpen && (
        <div className="explainer">
          <p className="ex-intro">{EXPLAINER.intro}</p>
          {EXPLAINER.cards.map((c) => (
            <div className="ex-card" key={c.n}>
              <span className="ex-n">{c.n}</span>
              <div>
                <b>{c.head}</b>
                <p>{c.body}</p>
              </div>
            </div>
          ))}
          <p className="ex-close">{EXPLAINER.close}</p>
          <p className="ex-kicker">{EXPLAINER.kicker}</p>
        </div>
      )}
    </section>
  );
}
