import type { Element, ElementContent, Root, RootContent } from "hast";
import type { Plugin } from "unified";
import type { Annotation, SentenceAnchor } from "./review";
import type { LegacyBlock } from "./document";

export type SentenceOptions = {
  sectionId: string;
  offset: number;
  end: number;
  legacyBlocks: LegacyBlock[];
  annotations: Annotation[];
  readOnly?: boolean;
};
export type SentenceTarget = { id: string; sectionId: string; blockId: string; quote: string; anchor: SentenceAnchor; annotationIds: string[] };

export function sentenceRanges(text: string): { start: number; end: number }[] {
  const segments = typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter("nb", { granularity: "sentence" }).segment(text), (part) => ({ index: part.index, value: part.segment }))
    : Array.from(text.matchAll(/[^.!?]+(?:[.!?]+|$)/g), (part) => ({ index: part.index!, value: part[0] }));
  return segments.flatMap(({ index, value }) => {
    const start = index + value.length - value.trimStart().length;
    const end = index + value.trimEnd().length;
    return start < end ? [{ start, end }] : [];
  });
}

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  if (node.tagName === "br") return "\n";
  if (node.tagName === "img") return String(node.properties.alt || "\uFFFC");
  return node.children.map(textOf).join("");
}

/** Slice the rendered text, cloning inline formatting across sentence boundaries. */
function sliceInline(nodes: ElementContent[], from: number, to: number): ElementContent[] {
  let cursor = 0;
  const result: ElementContent[] = [];
  for (const node of nodes) {
    const length = textOf(node).length;
    const start = cursor;
    cursor += length;
    if (!length) {
      if (start >= from && start < to) result.push(node);
      continue;
    }
    if (cursor <= from || start >= to) continue;
    if (node.type === "text") result.push({ ...node, value: node.value.slice(Math.max(0, from - start), Math.min(length, to - start)) });
    else if (node.type === "element") {
      result.push(node.tagName === "br" || node.tagName === "img" ? node : {
        ...node,
        // The sentence is the keyboard target; modifier-click still opens a link.
        properties: { ...node.properties, ...(node.tagName === "a" ? { tabIndex: -1 } : {}) },
        children: sliceInline(node.children, Math.max(0, from - start), Math.min(length, to - start)),
      });
    }
  }
  return result;
}

const blockTags = new Set(["p", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "pre", "blockquote", "div", "section", "h1", "h2", "h3", "h4", "h5", "h6"]);
const normal = (text: string) => text.replace(/\s+/g, " ").trim();

export const rehypeSentences: Plugin<[SentenceOptions], Root> = (options) => (tree) => {
  const candidates: { element: Element; target: SentenceTarget }[] = [];
  function wrap(nodes: ElementContent[], parent: Element): ElementContent[] {
    const meaningful = nodes.filter((node) => textOf(node).trim());
    if (!meaningful.length) return nodes;
    const localStart = meaningful[0].position?.start.offset ?? parent.position?.start.offset;
    const localEnd = meaningful.at(-1)?.position?.end.offset ?? parent.position?.end.offset;
    if (localStart === undefined || localEnd === undefined) return nodes;
    const blockStart = options.offset + localStart;
    const blockEnd = options.offset + localEnd;
    // Appended definitions retain references but are not new original text.
    if (blockStart >= options.end) return nodes;
    const text = nodes.map(textOf).join("");
    const legacyId = options.legacyBlocks.find((block) => blockStart >= block.start && blockStart < block.end)?.id ?? options.sectionId;
    const result: ElementContent[] = [];
    let cursor = 0;
    sentenceRanges(text).forEach(({ start, end }, sentenceIndex) => {
      if (start > cursor) result.push(...sliceInline(nodes, cursor, start));
      const quote = text.slice(start, end);
      const target: SentenceTarget = {
        id: `sentence-${blockStart}-${sentenceIndex}`,
        sectionId: options.sectionId,
        blockId: legacyId,
        quote,
        anchor: { blockStart, blockEnd, sentenceIndex, textStart: start, textEnd: end, exact: quote, prefix: text.slice(Math.max(0, start - 64), start), suffix: text.slice(end, end + 64) },
        annotationIds: [],
      };
      const element: Element = { type: "element", tagName: "span", properties: { className: ["sentence"], dataSentenceId: target.id }, children: sliceInline(nodes, start, end) };
      candidates.push({ element, target });
      result.push(element);
      cursor = end;
    });
    if (cursor < text.length) result.push(...sliceInline(nodes, cursor, text.length));
    return result;
  }
  function walk(parent: Root | Element) {
    if (parent.type === "element" && ["pre", "code", "script", "style"].includes(parent.tagName)) return;
    if (parent.type === "element" && ["p", "li", "td", "th"].includes(parent.tagName)) {
      const output: ElementContent[] = [];
      let run: ElementContent[] = [];
      const flush = () => { if (run.length) output.push(...wrap(run, parent)); run = []; };
      for (const child of parent.children) {
        if (child.type === "element" && blockTags.has(child.tagName)) {
          flush();
          walk(child);
          output.push(child);
        } else run.push(child);
      }
      flush();
      parent.children = output;
    } else {
      for (const child of parent.children as RootContent[]) if (child.type === "element") walk(child);
    }
  }
  walk(tree);
  for (const annotation of options.annotations) {
    const matches = candidates.filter(({ target }) => {
      if (annotation.anchor) return annotation.sectionId === target.sectionId && annotation.anchor.blockStart === target.anchor.blockStart && annotation.anchor.sentenceIndex === target.anchor.sentenceIndex && normal(annotation.quote) === normal(target.quote);
      return annotation.blockId === target.blockId && normal(annotation.quote) === normal(target.quote);
    });
    // Do not silently attach ambiguous legacy quotes to the wrong occurrence.
    if (matches.length === 1) matches[0].target.annotationIds.push(annotation.id);
  }
  for (const { element, target } of candidates) {
    element.properties.dataSentence = JSON.stringify(target);
    if (target.annotationIds.length) element.properties.className = ["sentence", "annotated"];
    if (!options.readOnly || target.annotationIds.length) {
      element.properties.role = "button";
      element.properties.tabIndex = 0;
      element.properties.ariaLabel = `${options.readOnly ? "Vis kommentarer" : "Kommenter"}: ${target.quote}`;
    }
  }
};
