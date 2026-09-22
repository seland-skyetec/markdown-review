import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildDocument } from "../lib/document";
import { rehypeSentences, sentenceRanges } from "../lib/sentences";
import type { Annotation } from "../lib/review";

function render(source: string, annotations: Annotation[] = []) {
  const model = buildDocument(source);
  const section = model.byId[model.groups[0]];
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    children: source.slice(section.bodyStart, section.end) + `\n\n${model.definitions}`,
    remarkPlugins: [remarkGfm],
    rehypePlugins: [[rehypeSentences, { sectionId: section.id, offset: section.bodyStart, end: section.end, legacyBlocks: model.legacyBlocks, annotations }]],
    skipHtml: true,
  }));
}

test("sentence segmentation retains Unicode and whitespace positions", () => {
  const text = "  Dette er en setning. Neste inneholder æ, ø, å og 🧭.";
  const ranges = sentenceRanges(text);
  assert.deepEqual(ranges.map(({ start, end }) => text.slice(start, end)), ["Dette er en setning.", "Neste inneholder æ, ø, å og 🧭."]);
});

test("one sentence wraps across bold, emphasis, code and reference links without losing markup", () => {
  const html = render("## Del\n\nDette er **viktig** med *kursiv*, `kode` og [lenke][ref]. Neste setning.\n\n[ref]: https://example.com");
  assert.ok(html.includes("<strong>viktig</strong>"));
  assert.ok(html.includes("<em>kursiv</em>"));
  assert.ok(html.includes("<code>kode</code>"));
  assert.ok(html.includes('href="https://example.com"'));
  assert.equal((html.match(/data-sentence-id=/g) ?? []).length, 2);
  assert.ok(html.includes("</span> <span"));
});

test("code fences are never split into sentence buttons; lists and tables are annotatable", () => {
  const html = render("## Del\n\n```js\n// Hei. Verden.\n```\n\n- En setning.\n- Neste setning.\n\n| Kolonne |\n| --- |\n| Tabelltekst. |\n");
  assert.ok(html.includes("<pre><code"));
  const code = html.slice(html.indexOf("<pre>"), html.indexOf("</pre>"));
  assert.ok(!code.includes("data-sentence"));
  assert.ok(html.includes("<li><span"));
  assert.ok(html.includes("<td><span"));
});

test("unique legacy comments reattach; duplicate legacy text remains unambiguously unanchored", () => {
  const one = "## Del\n\nEn setning. Neste setning.";
  const annotation: Annotation = { id: "old", blockId: "b-2", quote: "En setning.", comment: "Sjekk", createdAt: "2026-09-22T20:00:00Z" };
  assert.equal((render(one, [annotation]).match(/class="sentence annotated"/g) ?? []).length, 1);
  assert.equal((render("## Del\n\nEn setning. En setning.", [annotation]).match(/class="sentence annotated"/g) ?? []).length, 0);
});

test("a modern anchor distinguishes two identical sentences within the same paragraph", () => {
  const source = "## Del\n\nLik setning. Lik setning.";
  const start = source.indexOf("Lik");
  const annotation: Annotation = {
    id: "new", blockId: "b-2", sectionId: "s-0", quote: "Lik setning.", comment: "Bare den andre", createdAt: "2026-09-22T20:00:00Z",
    anchor: { blockStart: start, blockEnd: source.length, sentenceIndex: 1, textStart: 13, textEnd: 25, exact: "Lik setning.", prefix: "Lik setning. ", suffix: "" },
  };
  const html = render(source, [annotation]);
  assert.equal((html.match(/class="sentence annotated"/g) ?? []).length, 1);
  assert.ok(html.includes(`data-sentence-id="sentence-${start}-1"`));
});

test("raw HTML is not executable and source strings stay unchanged", () => {
  const source = "## Del\r\n\r\nNorsk æøå.\r\n\r\n<script>alert('bad')</script>\r\n";
  const original = source;
  const html = render(source);
  assert.ok(!html.includes("<script>"));
  assert.equal(source, original);
});
