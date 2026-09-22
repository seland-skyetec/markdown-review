"use client";

import { useEffect, useState } from "react";
import { reviewScope, type DocumentModel } from "@/lib/document";

export function Outline({ model, activeId, reviewed, counts, onSelect }: { model: DocumentModel; activeId: string; reviewed: Set<string>; counts: Record<string, number>; onSelect: (id: string) => void }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  useEffect(() => {
    setClosed((current) => {
      const next = new Set(current);
      let section = model.byId[activeId];
      while (section?.parentId) { next.delete(section.parentId); section = model.byId[section.parentId]; }
      return next;
    });
  }, [activeId, model]);
  const toggle = (id: string) => setClosed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  function render(ids: string[], nested = false) {
    return <ul className={nested ? "outline-children" : "outline-root"}>
      {ids.map((id) => {
        const section = model.byId[id];
        const scope = reviewScope(model, id);
        const done = scope.length > 0 && scope.every((item) => reviewed.has(item.id));
        const expanded = !closed.has(id);
        return <li key={id}>
          <div className={`outline-row ${id === activeId ? "active" : ""} ${done ? "is-done" : ""}`}>
            {section.children.length ? <button type="button" className="outline-disclosure" aria-label={`${expanded ? "Skjul" : "Vis"} underoverskrifter: ${section.title}`} aria-expanded={expanded} aria-controls={`outline-${id}`} onClick={() => toggle(id)}><span aria-hidden="true">{expanded ? "⌄" : "›"}</span></button> : <span className="outline-spacer" />}
            <button type="button" className="outline-link" aria-current={id === activeId ? "location" : undefined} onClick={() => onSelect(id)} title={section.title}>
              <span className="outline-title">{section.title}</span>
              {done ? <span className="outline-done" aria-label="Gjennomgått">✓</span> : counts[id] ? <span className="outline-count" aria-label={`${counts[id]} kommentarer`}>{counts[id]}</span> : null}
            </button>
          </div>
          {!!section.children.length && <div id={`outline-${id}`} hidden={!expanded}>{render(section.children, true)}</div>}
        </li>;
      })}
    </ul>;
  }
  return <nav aria-label="Overskrifter">{render(model.roots)}</nav>;
}
