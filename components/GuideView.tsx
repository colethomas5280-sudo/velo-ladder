"use client";

import type { ReactNode } from "react";
import type { MarkdownNode } from "@/lib/miniMarkdown";

/* ------------------------------------------------------------------ *
 * The evaluation scoring guide
 *
 * Presentation only. There is deliberately no role check in here: this
 * component receives `nodes` as a prop, and a prop from a server component
 * is serialized into the payload the browser receives, so hiding it
 * client-side would still hand the text to an athlete. The gate lives in
 * app/velo/guide/page.tsx, which never reads the guide for a non-coach.
 * ------------------------------------------------------------------ */

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
