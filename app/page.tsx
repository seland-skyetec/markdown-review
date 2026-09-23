"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Outline } from "@/components/outline";
import { SectionReader } from "@/components/section-reader";
import { buildDocument, reviewScope, reviewUnits, sectionForAnnotation } from "@/lib/document";
import type { SentenceTarget } from "@/lib/sentences";
import type { Annotation, Retention } from "@/lib/review";
import { useReview } from "@/lib/use-review";
import { forgetRecentReview, onRecentReviewsChanged, readRecentReviews, type RecentReviewRef } from "@/lib/recent";

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type RecentSummary = RecentReviewRef & {
  updatedAt: string;
  sourceAvailable: boolean;
  reviewedCount: number;
  annotationCount: number;
};

function MenuIcon() {
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" /><path d="M7 4v12" stroke="currentColor" /></svg>;
}

export default function Home() {
  const review = useReview();
  const { session, loading, error, saveState } = review;
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("document.md");
  const [retention, setRetention] = useState<Retention>("1w");
  const [pasteMode, setPasteMode] = useState(false);
  const [activeId, setActiveId] = useState("");
  const [selected, setSelected] = useState<SentenceTarget | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { target: SentenceTarget; text: string }>>({});
  const [showErrata, setShowErrata] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareFallback, setShareFallback] = useState("");
  const [copying, setCopying] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const [recentReviews, setRecentReviews] = useState<RecentSummary[]>([]);
  const model = useMemo(() => buildDocument(session?.source ?? source), [session?.source, source]);
  const reviewed = useMemo(() => new Set(session?.reviewed ?? []), [session?.reviewed]);
  const units = useMemo(() => reviewUnits(model), [model]);
  const currentId = model.byId[activeId] ? activeId : model.groups[0] ?? "";
  const groupId = model.byId[currentId]?.groupId ?? model.groups[0] ?? "";
  const groupIndex = model.groups.indexOf(groupId);
  const readOnly = !session?.editToken;
  const panelOpen = !!selected || showErrata;
  const comments = session?.annotations ?? [];
  const comment = selected ? drafts[selected.id]?.text ?? "" : "";
  const complete = units.filter((section) => reviewed.has(section.id)).length;
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const annotation of session?.annotations ?? []) {
      const section = sectionForAnnotation(model, annotation);
      if (section) result[section.id] = (result[section.id] ?? 0) + 1;
    }
    return result;
  }, [session?.annotations, model]);

  useEffect(() => {
    if (!session) return;
    const first = reviewUnits(model).find((section) => !session.reviewed.includes(section.id));
    const id = first?.groupId ?? model.groups[0] ?? "";
    setActiveId(id);
    setSelected(null);
    setShowErrata(!session.source);
    // Resume once when opening a document, not after each checkbox/save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, model]);

  useEffect(() => {
    if (session) return;
    let cancelled = false;
    const loadRecent = async () => {
      const refs = readRecentReviews();
      const items = await Promise.all(refs.map(async (ref) => {
        try {
          const response = await fetch(`/api/reviews/${encodeURIComponent(ref.id)}?meta=1`, { cache: "no-store" });
          if (response.status === 404) {
            forgetRecentReview(ref.id);
            return null;
          }
          if (!response.ok) return null;
          const meta = await response.json() as Omit<RecentSummary, keyof RecentReviewRef>;
          return { ...ref, ...meta } as RecentSummary;
        } catch {
          return null;
        }
      }));
      if (!cancelled) setRecentReviews(items.filter((item): item is RecentSummary => item !== null));
    };
    void loadRecent();
    const unsubscribe = onRecentReviewsChanged(() => void loadRecent());
    return () => { cancelled = true; unsubscribe(); };
  }, [session?.id]);

  const hasDrafts = Object.values(drafts).some((draft) => draft.text.trim());
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (hasDrafts) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [hasDrafts]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSelected(null); setShowErrata(false); setOutlineOpen(false); }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  async function ingestFile(file: File) {
    if (!/\.(md|markdown|txt)$/i.test(file.name) && !["text/markdown", "text/plain"].includes(file.type)) { review.setError("Velg en Markdown-fil."); return; }
    if (file.size > 2 * 1024 * 1024) { review.setError("Dokumentet er større enn 2 MB."); return; }
    try { setSource(await file.text()); setFilename(file.name); review.setError(null); }
    catch { review.setError("Kunne ikke lese filen."); }
  }
  function navigate(id: string) {
    const section = model.byId[id];
    if (!section) return;
    setActiveId(id === model.wrapperId && !section.hasContent ? section.groupId : id);
    setSelected(null);
    setOutlineOpen(false);
  }
  function toggleSection(id: string) {
    const scope = reviewScope(model, id).map((section) => section.id);
    review.update((value) => {
      const next = new Set(value.reviewed);
      const done = scope.every((key) => next.has(key));
      for (const key of scope) { if (done) next.delete(key); else next.add(key); }
      return { ...value, reviewed: [...next] };
    });
  }
  function selectSentence(target: SentenceTarget) {
    setSelected(target);
    setShowErrata(false);
  }
  function clearDraft(id: string) {
    setDrafts((value) => { const next = { ...value }; delete next[id]; return next; });
  }
  function addAnnotation() {
    if (!selected || !comment.trim() || readOnly) return;
    const annotation: Annotation = { id: crypto.randomUUID(), blockId: selected.blockId, sectionId: selected.sectionId, anchor: selected.anchor, quote: selected.quote, comment: comment.trim(), createdAt: new Date().toISOString() };
    review.update((value) => ({ ...value, annotations: [...value.annotations, annotation] }));
    clearDraft(selected.id);
    setSelected(null);
  }
  function deleteAnnotation(id: string) {
    review.update((value) => ({ ...value, annotations: value.annotations.filter((annotation) => annotation.id !== id) }));
  }
  async function copyAgentLink() {
    if (!session || copying) return;
    const draft = Object.values(drafts).find((value) => value.text.trim());
    if (draft) {
      navigate(draft.target.sectionId);
      setSelected(draft.target);
      review.setError("Lagre eller forkast kommentaren før du deler.");
      return;
    }
    setCopying(true);
    try {
      if (!await review.flush()) return;
      const url = `${window.location.origin}/api/reviews/${session.id}`;
      try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
      catch { setShareFallback(url); }
    } finally { setCopying(false); }
  }
  async function resetApp() {
    if (hasDrafts && !window.confirm("Forkaste ulagrede kommentarer og åpne et nytt dokument?")) return;
    if (!await review.reset()) return;
    setSource(""); setFilename("document.md"); setActiveId(""); setSelected(null); setDrafts({}); setShowErrata(false); setShareFallback(""); setPasteMode(false);
  }
  function exportErrata() {
    if (!session) return;
    downloadText(`${session.filename.replace(/\.md$/i, "")}-errata.json`, JSON.stringify({ reviewId: session.id, annotations: session.annotations, reviewedBlockIds: session.reviewed, sections: units.map((section) => ({ id: section.id, title: section.title, reviewed: reviewed.has(section.id) })) }, null, 2), "application/json");
  }

  if (loading && !session) return <main className="loading-screen" aria-label="Åpner dokument" role="status"><span className="spinner" /></main>;

  if (!session) return <main
    className={`setup-shell ${dragActive ? "is-dragging" : ""}`}
    onDragEnter={(event) => {
      event.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    }}
    onDragOver={(event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }}
    onDragLeave={(event) => {
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    }}
    onDrop={(event) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const file = event.dataTransfer.files[0];
      if (file) void ingestFile(file);
    }}
  >
    <section className="setup-card">
      <h1 className="setup-title">Markdown-review</h1>
      <input ref={fileInput} hidden type="file" accept=".md,.markdown,.txt,text/markdown" onChange={(event) => { const file = event.target.files?.[0]; if (file) void ingestFile(file); event.target.value = ""; }} />
      {pasteMode ? <textarea className="source-input" aria-label="Markdown" autoFocus value={source} onChange={(event) => { setSource(event.target.value); setFilename("document.md"); }} placeholder="Lim inn Markdown…" />
        : <button type="button" className={`dropzone ${source ? "has-file" : ""}`} onClick={() => fileInput.current?.click()}><span className="drop-icon" aria-hidden="true">＋</span><span>{source ? filename : "Velg Markdown"}</span>{source && <small>{model.groups.length} seksjoner</small>}</button>}
      <button className="text-button mode-toggle" onClick={() => setPasteMode((value) => !value)}>{pasteMode ? "Velg fil" : "Lim inn i stedet"}</button>
      <div className="setup-footer">
        <select aria-label="Lagringstid for original" value={retention} onChange={(event) => setRetention(event.target.value as Retention)} title="Lagringstid for originalen. Errata beholdes."><option value="1d">Original: 1 dag</option><option value="1w">Original: 1 uke</option><option value="1m">Original: 1 måned</option><option value="never">Original: aldri slett</option></select>
        <button className="primary-button" disabled={!source.trim() || loading} onClick={() => void review.create(source, filename, retention)}>Start</button>
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!!recentReviews.length && <section className="recent-reviews" aria-label="Siste dokumenter">
        <h2>Siste dokumenter</h2>
        <div className="recent-list">
          {recentReviews.map((item) => <div className="recent-row" key={item.id}>
            <button className="recent-open" onClick={() => { window.location.href = `/?review=${item.id}`; }}>
              <span className="recent-name">{item.filename}</span>
              <span className="recent-meta">
                {item.sourceAvailable
                  ? <>{item.reviewedCount} gjennomgått{item.annotationCount ? ` · ${item.annotationCount} kommentar${item.annotationCount === 1 ? "" : "er"}` : ""}</>
                  : <>Kilde utløpt{item.annotationCount ? ` · ${item.annotationCount} kommentar${item.annotationCount === 1 ? "" : "er"}` : ""}</>}
              </span>
            </button>
            <button className="recent-remove" aria-label={`Fjern ${item.filename} fra siste dokumenter`} title="Fjern fra listen" onClick={() => forgetRecentReview(item.id)}>×</button>
          </div>)}
        </div>
      </section>}
    </section>
  </main>;

  function annotationCard(annotation: Annotation) {
    const section = sectionForAnnotation(model, annotation);
    return <article className="annotation-card" key={annotation.id}>
      {!selected && <q>{annotation.quote}</q>}
      <p>{annotation.comment}</p>
      <div className="annotation-actions">
        {!selected && section && <button className="text-button" onClick={() => { navigate(section.id); setShowErrata(false); }}>Vis i tekst</button>}
        {!readOnly && <button className="text-button danger-hover" aria-label={`Slett kommentar: ${annotation.comment}`} onClick={() => deleteAnnotation(annotation.id)}>Slett</button>}
      </div>
    </article>;
  }

  return <main className="review-shell">
    <header className="topbar">
      <div className="topbar-document">
        <button className="icon-button outline-toggle" aria-label="Innhold" aria-expanded={outlineOpen} aria-controls="document-outline" onClick={() => setOutlineOpen((value) => !value)}><MenuIcon /></button>
        <span className="file-title" title={session.filename}>{session.filename}</span>
        {readOnly && <span className="read-only-label">Kun lesing</span>}
      </div>
      <div className="topbar-status" role="status" aria-live="polite">
        {!!units.length && <span title="Gjennomgåtte deler">{complete}<span className="muted"> / {units.length}</span></span>}
        {saveState === "pending" || saveState === "saving" ? <span className="save-dot" title="Lagrer"><span className="sr-only">Lagrer</span></span> : null}
      </div>
      <div className="top-actions">
        {!!comments.length && <button className={`toolbar-button ${showErrata ? "active" : ""}`} onClick={() => { setSelected(null); setShowErrata((value) => !value); }}>Errata <span className="badge">{comments.length}</span></button>}
        <button className="toolbar-button primary" disabled={copying} onClick={() => void copyAgentLink()}>{copied ? "Kopiert" : "Kopier lenke"}</button>
        <details className="document-menu"><summary aria-label="Dokumentmeny">···</summary><div className="menu-content"><button onClick={() => void resetApp()}>Nytt dokument</button>{session.source !== null && <button onClick={() => downloadText(session.filename, session.source!, "text/markdown")}>Last ned original</button>}<button onClick={exportErrata}>Eksporter errata</button></div></details>
      </div>
    </header>

    {(error || saveState === "error" || shareFallback) && <div className="notice" role="alert">
      {saveState === "error" ? <><span>Kunne ikke lagre endringene.</span><button onClick={() => void review.flush()}>Prøv igjen</button></> : <><span>{error}</span>{error && <button aria-label="Lukk melding" onClick={() => review.setError(null)}>×</button>}</>}
      {shareFallback && <input aria-label="Agentlenke" readOnly value={shareFallback} onFocus={(event) => event.target.select()} />}
    </div>}

    <div className={`workspace ${panelOpen ? "has-panel" : ""}`}>
      {outlineOpen && <button className="outline-backdrop" aria-label="Lukk innhold" onClick={() => setOutlineOpen(false)} />}
      <aside id="document-outline" className={`section-rail ${outlineOpen ? "is-open" : ""}`}>
        <Outline model={model} activeId={currentId} reviewed={reviewed} counts={counts} onSelect={navigate} />
      </aside>
      <div className="reader-scroll">
        <div className="reading-column">
          {groupId ? <>
            <SectionReader model={model} groupId={groupId} activeId={currentId} selectedId={selected?.id} annotations={comments} reviewed={reviewed} readOnly={readOnly} onToggle={toggleSection} onSelect={selectSentence} />
            {model.groups.length > 1 && <nav className="chapter-navigation" aria-label="Seksjonsnavigasjon">
              <button className="nav-button" disabled={groupIndex <= 0} onClick={() => navigate(model.groups[groupIndex - 1])}>← <span>Forrige seksjon</span></button>
              <span className="chapter-position">{groupIndex + 1} / {model.groups.length}</span>
              <button className="nav-button" disabled={groupIndex >= model.groups.length - 1} onClick={() => navigate(model.groups[groupIndex + 1])}><span>Neste seksjon</span> →</button>
            </nav>}
          </> : <div className="empty-source"><h1>Kilden er utløpt.</h1><p>Errata er beholdt.</p></div>}
        </div>
      </div>
      {panelOpen && <aside className="review-panel" role="complementary" aria-label={selected ? "Kommentar" : "Errata"}>
        <header className="panel-heading"><h2>{selected ? "Kommentar" : "Errata"}</h2><button className="icon-button" aria-label="Lukk panel" onClick={() => { setSelected(null); setShowErrata(false); }}>×</button></header>
        <div className="panel-content">
          {selected ? <>
            <blockquote className="selected-quote">{selected.quote}</blockquote>
            {comments.filter((annotation) => selected.annotationIds.includes(annotation.id)).map(annotationCard)}
            {!readOnly && <form className="comment-composer" onSubmit={(event) => { event.preventDefault(); addAnnotation(); }}>
              <label className="sr-only" htmlFor="comment-input">Kommentar til valgt setning</label>
              <textarea key={selected.id} id="comment-input" autoFocus value={comment} placeholder="Kommentar…" onChange={(event) => setDrafts((value) => ({ ...value, [selected.id]: { target: selected, text: event.target.value } }))} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); addAnnotation(); } }} />
              <div className="composer-actions"><button className="text-button" type="button" onClick={() => { clearDraft(selected.id); setSelected(null); }}>Forkast</button><button className="primary-button" type="submit" disabled={!comment.trim()}>Lagre</button></div>
            </form>}
          </> : comments.map(annotationCard)}
        </div>
        {showErrata && <footer className="panel-footer"><button className="toolbar-button" onClick={exportErrata}>Eksporter errata</button></footer>}
      </aside>}
    </div>
  </main>;
}
