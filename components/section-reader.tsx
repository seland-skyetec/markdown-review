"use client";

import { memo, useEffect, useMemo, useRef, type MouseEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeSentences, type SentenceTarget } from "@/lib/sentences";
import { groupSections, reviewScope, type DocumentModel, type Section } from "@/lib/document";
import type { Annotation } from "@/lib/review";

export function ReviewCheck({ title, checked, mixed, disabled, onChange }: { title: string; checked: boolean; mixed: boolean; disabled: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <label className={`review-check ${checked ? "is-done" : ""}`} title={checked ? "Gjennomgått" : "Merk seksjonen som gjennomgått"}>
    <input ref={ref} type="checkbox" aria-label={`Gjennomgått: ${title}`} checked={checked} disabled={disabled} onChange={onChange} />
  </label>;
}

const Body = memo(function Body({ model, section, annotations, readOnly }: { model: DocumentModel; section: Section; annotations: Annotation[]; readOnly: boolean }) {
  const markdown = model.source.slice(section.bodyStart, section.end) + (model.definitions ? `\n\n${model.definitions}` : "");
  const options = useMemo(() => ({ sectionId: section.id, offset: section.bodyStart, end: section.end, legacyBlocks: model.legacyBlocks, annotations, readOnly }), [section, model.legacyBlocks, annotations, readOnly]);
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSentences, options]]} skipHtml>{markdown}</ReactMarkdown></div>;
});

export function SectionReader({ model, groupId, activeId, selectedId, annotations, reviewed, readOnly, onToggle, onSelect }: {
  model: DocumentModel; groupId: string; activeId: string; selectedId?: string;
  annotations: Annotation[]; reviewed: Set<string>; readOnly: boolean;
  onToggle: (id: string) => void; onSelect: (target: SentenceTarget) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const visible = groupSections(model, groupId);
  useEffect(() => {
    const target = document.getElementById(`heading-${activeId}`);
    if (target) target.scrollIntoView({ block: "start", behavior: "instant" });
  }, [groupId, activeId]);
  useEffect(() => {
    container.current?.querySelectorAll("[data-selected]").forEach((element) => element.removeAttribute("data-selected"));
    if (selectedId) container.current?.querySelector(`[data-sentence-id="${CSS.escape(selectedId)}"]`)?.setAttribute("data-selected", "true");
  }, [selectedId, groupId, annotations]);

  function select(event: MouseEvent | KeyboardEvent) {
    if (event.type === "keydown" && !["Enter", " "].includes((event as KeyboardEvent).key)) return;
    const origin = event.target as HTMLElement;
    if ((event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey) return;
    const element = origin.closest<HTMLElement>("[data-sentence]");
    if (!element || !container.current?.contains(element) || window.getSelection()?.toString()) return;
    const target = JSON.parse(element.dataset.sentence!) as SentenceTarget;
    if (readOnly && !target.annotationIds.length) return;
    event.preventDefault();
    onSelect(target);
  }

  return <div ref={container} className={`section-reader ${readOnly ? "read-only" : ""}`} onClick={select} onKeyDown={select}>
    {visible.map((section, index) => {
      const scope = reviewScope(model, section.id);
      const count = scope.filter((item) => reviewed.has(item.id)).length;
      const done = scope.length > 0 && count === scope.length;
      const Heading = index === 0 ? "h1" : section.depth > model.byId[groupId].depth + 1 ? "h3" : "h2";
      return <section key={section.id} className={`reading-section ${index === 0 ? "chapter" : "subsection"} ${done ? "is-done" : ""}`} aria-labelledby={`heading-${section.id}`} data-section-id={section.id}>
        <header className="section-heading" id={`heading-${section.id}`}>
          <Heading>{section.title}</Heading>
          {!!scope.length && <ReviewCheck title={section.title} checked={done} mixed={count > 0 && !done} disabled={readOnly} onChange={() => onToggle(section.id)} />}
        </header>
        {section.hasContent && <Body model={model} section={section} annotations={annotations} readOnly={readOnly} />}
      </section>;
    })}
  </div>;
}
