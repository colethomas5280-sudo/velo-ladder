"use client";

import useSWR from "swr";
import type { ReactNode } from "react";
import type { MarkdownNode } from "@/lib/miniMarkdown";
import { fetcher } from "@/lib/fetcher";

/* ------------------------------------------------------------------ *
 * The evaluation scoring guide
 *
 * Coach-only, same shape as VeloLadder: an SWR fetch of /api/me and a role
 * check, nothing rendered for anyone who isn't a coach. app/velo/guide/
 * page.tsx resolves the file server-side (lib/miniMarkdown.ts is pure and
 * never touches disk) and hands the rendered nodes down as a prop, so the
 * markdown file itself is never something a browser fetches.
 * ------------------------------------------------------------------ */

type Me = { role: "coach" | "athlete" | "none" };

/** The one inline construct: `**text**` becomes <strong>. Everything else is literal. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    return bold ? <strong key={i}>{bold[1]}</strong> : part;
  });
}

function GuideBlock({ node }: { node: MarkdownNode }) {
  if (node.kind === "heading") {
    const Tag = `h${node.level}` as "h1" | "h2" | "h3";
    return <Tag>{renderInline(node.text)}</Tag>;
  }

  if (node.kind === "paragraph") {
    return <p>{renderInline(node.text)}</p>;
  }

  if (node.kind === "list") {
    return (
      <ul>
        {node.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }

  return (
    <div className="scroll-x">
      <table className="roster-table">
        <thead>
          <tr>
            {node.header.map((cell, i) => (
              <th key={i}>{renderInline(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{renderInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GuideView({ nodes }: { nodes: MarkdownNode[] }) {
  const { data: me, isLoading } = useSWR<Me>("/api/me", fetcher);

  if (isLoading || !me) {
    return (
      <div className="card pad" style={{ color: "var(--ink-dim)" }}>
        Loading&hellip;
      </div>
    );
  }

  if (me.role !== "coach") {
    return (
      <div className="card pad empty">
        <div className="eyebrow">Evaluation Scoring Guide</div>
        <h3>Not available</h3>
        <p>This page is for coaches only.</p>
      </div>
    );
  }

  return (
    <>
      <div className="tests-head">
        <div className="eyebrow">Evaluation Scoring Guide</div>
        <h2>Scoring the ladder</h2>
        <p className="sub">
          Read alongside the benchmark ladder. Edit
          content/evaluation-scoring-guide.md to change this text.
        </p>
      </div>
      <section className="card pad guide">
        {nodes.map((node, i) => (
          <GuideBlock key={i} node={node} />
        ))}
      </section>
    </>
  );
}
