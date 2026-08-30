import { Fragment, type ReactNode } from "react";

/**
 * A deliberately small formatter for resource bodies. It builds React nodes
 * rather than injecting HTML, so nothing a coach types can execute.
 *
 *   ## Heading
 *   - bullet
 *   **bold**
 *   bare URLs become links
 *   blank line = new paragraph
 */
export default function RichText({ text }: { text: string }) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];

  const flushPara = (key: string) => {
    if (!para.length) return;
    out.push(<p key={key}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushBullets = (key: string) => {
    if (!bullets.length) return;
    out.push(
      <ul key={key}>
        {bullets.map((b, i) => (
          <li key={i}>{inline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flushBullets(`u${i}`);
      flushPara(`p${i}`);
      return;
    }
    if (line.startsWith("## ")) {
      flushBullets(`u${i}`);
      flushPara(`p${i}`);
      out.push(<h4 key={`h${i}`}>{inline(line.slice(3))}</h4>);
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushPara(`p${i}`);
      bullets.push(line.slice(2));
      return;
    }
    flushBullets(`u${i}`);
    para.push(line);
  });
  flushBullets("u-end");
  flushPara("p-end");

  return <div className="rich">{out}</div>;
}

/** **bold** and bare URLs, nothing else. */
function inline(s: string): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*)|(https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = pattern.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    if (m[1]) parts.push(<b key={k++}>{m[1].slice(2, -2)}</b>);
    else if (m[2])
      parts.push(
        <a key={k++} href={m[2]} target="_blank" rel="noopener noreferrer">
          {m[2].replace(/^https?:\/\//, "")}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return <Fragment>{parts}</Fragment>;
}
