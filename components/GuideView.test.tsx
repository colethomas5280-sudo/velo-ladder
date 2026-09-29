import "./testDom";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, cleanup } from "@testing-library/react";
import type { MarkdownNode } from "@/lib/miniMarkdown";
import GuideView from "./GuideView";

/* ------------------------------------------------------------------ *
 * Bold inline
 *
 * lib/miniMarkdown.ts leaves `**bold**` as literal text on purpose, so the
 * conversion in GuideView is the only place it becomes a <strong>. Nothing
 * else would notice if that regex broke: the real-guide test only reads
 * headings and the table.
 * ------------------------------------------------------------------ */

beforeEach(() => cleanup());

function body(nodes: MarkdownNode[]): HTMLElement {
  return render(<GuideView nodes={nodes} />).container.querySelector(".guide") as HTMLElement;
}

test("a bold fragment becomes a strong and the text around it is untouched", () => {
  const el = body([{ kind: "paragraph", text: "before **the call** after" }]);
  const p = el.querySelector("p")!;
  const strongs = p.querySelectorAll("strong");
  assert.equal(strongs.length, 1);
  assert.equal(strongs[0].textContent, "the call");
  assert.equal(p.textContent, "before the call after");
  assert.ok(!p.textContent!.includes("*"));
});

test("two bold runs in one line each become their own strong", () => {
  const el = body([{ kind: "list", items: ["**one** and **two**"] }]);
  const strongs = [...el.querySelectorAll("li strong")].map((s) => s.textContent);
  assert.deepEqual(strongs, ["one", "two"]);
});

test("bold works inside a table cell and a heading", () => {
  const el = body([
    { kind: "heading", level: 2, text: "A **bold** heading" },
    { kind: "table", header: ["H"], rows: [["**cell**"]] },
  ]);
  assert.equal(el.querySelector("h2 strong")?.textContent, "bold");
  assert.equal(el.querySelector("td strong")?.textContent, "cell");
});

test("an unmatched pair of asterisks stays literal", () => {
  const el = body([{ kind: "paragraph", text: "a **dangling marker" }]);
  assert.equal(el.querySelectorAll("strong").length, 0);
  assert.equal(el.querySelector("p")!.textContent, "a **dangling marker");
});
