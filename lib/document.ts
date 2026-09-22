import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";

export type Section = {
  id: string;
  title: string;
  depth: number;
  parentId: string | null;
  children: string[];
  start: number;
  bodyStart: number;
  end: number;
  hasContent: boolean;
  groupId: string;
};
export type LegacyBlock = { id: string; start: number; end: number };
export type DocumentModel = {
  source: string;
  sections: Section[];
  byId: Record<string, Section>;
  roots: string[];
  groups: string[];
  wrapperId: string | null;
  definitions: string;
  legacyBlocks: LegacyBlock[];
};

function plain(node: unknown): string {
  const item = node as { value?: string; alt?: string; children?: unknown[] };
  return item.value ?? item.alt ?? item.children?.map(plain).join("") ?? "";
}

/** Preserve v1 block identifiers for existing comments; never use them for navigation. */
export function legacyBlocks(source: string): LegacyBlock[] {
  const result: LegacyBlock[] = [];
  let start = 0;
  let end = 0;
  let fence: string | null = null;
  function flush() {
    const raw = source.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    if (raw.trim()) result.push({ id: `b-${result.length + 1}`, start: start + leading, end: start + raw.trimEnd().length });
  }
  for (const line of source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (!line[0]) continue;
    const text = line[0].replace(/[\r\n]+$/, "");
    const match = text.match(/^\s*(```+|~~~+)/);
    if (match) fence = fence === match[1][0] ? null : fence ?? match[1][0];
    if (!fence && !text.trim()) {
      flush();
      start = line.index! + line[0].length;
    }
    end = line.index! + line[0].length;
  }
  flush();
  return result;
}

export function buildDocument(source: string): DocumentModel {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source) as Root;
  const headings = tree.children.filter((node) => node.type === "heading");
  const sections: Section[] = [];
  const roots: string[] = [];
  const byId: Record<string, Section> = {};
  const stack: Section[] = [];
  const visible = (nodes: RootContent[]) => nodes.some((node) => !["definition", "footnoteDefinition"].includes(node.type));
  const add = (section: Section) => {
    sections.push(section);
    byId[section.id] = section;
    if (section.parentId) byId[section.parentId].children.push(section.id);
    else roots.push(section.id);
  };
  const firstStart = headings[0]?.position?.start.offset ?? source.length;
  const preamble = tree.children.filter((node) => (node.position?.start.offset ?? 0) < firstStart);
  if (visible(preamble) || (!headings.length && source.trim())) {
    add({ id: "s-intro", title: headings.length ? "Innledning" : "Dokument", depth: 1, parentId: null, children: [], start: 0, bodyStart: 0, end: firstStart, hasContent: true, groupId: "" });
  }
  headings.forEach((heading, index) => {
    const start = heading.position!.start.offset!;
    const end = headings[index + 1]?.position?.start.offset ?? source.length;
    const bodyStart = heading.position!.end.offset!;
    while (stack.length && stack.at(-1)!.depth >= heading.depth) stack.pop();
    const body = tree.children.filter((node) => (node.position?.start.offset ?? 0) >= bodyStart && (node.position?.start.offset ?? 0) < end);
    const section: Section = { id: `s-${start}`, title: plain(heading) || "Uten tittel", depth: heading.depth, parentId: stack.at(-1)?.id ?? null, children: [], start, bodyStart, end, hasContent: visible(body), groupId: "" };
    add(section);
    stack.push(section);
  });
  // A single H1 commonly names the document. Do not render the entire document
  // when its title is selected: its immediate children become bounded chapters.
  const headingRoots = roots.filter((id) => id !== "s-intro");
  const candidate = headingRoots.length === 1 ? byId[headingRoots[0]] : null;
  const wrapperId = candidate?.depth === 1 && candidate.children.length ? candidate.id : null;
  const groups = roots.flatMap((id) => id === wrapperId
    ? [...(byId[id].hasContent ? [id] : []), ...byId[id].children]
    : [id]);
  const assign = (id: string, groupId: string) => {
    byId[id].groupId = groupId;
    for (const child of byId[id].children) assign(child, groupId);
  };
  for (const id of groups) {
    if (id === wrapperId) byId[id].groupId = id;
    else assign(id, id);
  }
  if (wrapperId && !byId[wrapperId].groupId) byId[wrapperId].groupId = byId[wrapperId].children[0];
  const definitions = tree.children.filter((node) => ["definition", "footnoteDefinition"].includes(node.type))
    .map((node) => source.slice(node.position!.start.offset, node.position!.end.offset)).join("\n\n");
  return { source, sections, byId, roots, groups, wrapperId, definitions, legacyBlocks: legacyBlocks(source) };
}

export function groupSections(model: DocumentModel, groupId: string): Section[] {
  return model.sections.filter((section) => section.groupId === groupId && !(section.id === model.wrapperId && section.id !== groupId));
}

export function sectionScope(model: DocumentModel, id: string): Section[] {
  const section = model.byId[id];
  if (!section) return [];
  if (id === model.wrapperId) return section.hasContent ? [section] : model.byId[id].children.flatMap((child) => sectionScope(model, child));
  return [section, ...section.children.flatMap((child) => sectionScope(model, child))];
}

export function reviewUnits(model: DocumentModel): Section[] {
  return model.sections.filter((section) => section.hasContent || (!section.children.length && section.id !== model.wrapperId));
}

export function reviewScope(model: DocumentModel, id: string): Section[] {
  const units = new Set(reviewUnits(model).map((section) => section.id));
  return sectionScope(model, id).filter((section) => units.has(section.id));
}

export function normaliseReviewed(model: DocumentModel, oldIds: string[]): string[] {
  const old = new Set(oldIds);
  return reviewUnits(model).filter((section) => {
    if (old.has(section.id)) return true;
    // A partial v1 paragraph review must not imply a complete new section.
    const blocks = model.legacyBlocks.filter((block) => block.end > section.start && block.start < section.end);
    return blocks.length > 0 && blocks.every((block) => old.has(block.id));
  }).map((section) => section.id);
}

export function sectionForAnnotation(model: DocumentModel, annotation: { blockId: string; sectionId?: string; anchor?: { blockStart: number } }): Section | undefined {
  if (annotation.sectionId && model.byId[annotation.sectionId]) return model.byId[annotation.sectionId];
  const position = annotation.anchor?.blockStart ?? model.legacyBlocks.find((block) => block.id === annotation.blockId)?.start;
  return position === undefined ? undefined : model.sections.find((section) => position >= section.start && position < section.end);
}
