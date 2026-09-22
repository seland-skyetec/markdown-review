"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Annotation, Retention } from "@/lib/review";

type Block = {
  id: string;
  raw: string;
  title: string;
  kind: "heading" | "prose" | "code" | "structured";
};

type LoadedReview = {
  id: string;
  filename: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceExpiresAt: string | null;
  retention: Retention;
  reviewedBlockIds: string[];
  annotations: Annotation[];
  source: string | null;
  sourceAvailable: boolean;
};

const retentionLabels: Record<Retention, string> = {
  "1d": "1 dag",
  "1w": "1 uke",
  "1m": "1 måned",
  never: "Aldri",
};

function splitMarkdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const raw = current.join("\n").trim();
    if (raw) chunks.push(raw);
    current = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      current.push(line);
      continue;
    }
    if (!fence && !line.trim()) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();

  return chunks.map((raw, index) => {
    const plain = stripInlineMarkdown(raw).replace(/\s+/g, " ").trim();
    const heading = raw.match(/^#{1,6}\s+(.+)$/m)?.[1];
    const kind: Block["kind"] = /^\s*(```|~~~)/.test(raw)
      ? "code"
      : /^#{1,6}\s+/.test(raw)
        ? "heading"
        : /^(\s*[-*+]\s+|\s*\d+\.\s+|\s*>\s+|\s*\|)/m.test(raw)
          ? "structured"
          : "prose";
    const titleSource = heading ? stripInlineMarkdown(heading) : plain;
    return {
      id: `b-${index + 1}`,
      raw,
      title: titleSource.length > 72 ? `${titleSource.slice(0, 72)}…` : titleSource || `Blokk ${index + 1}`,
      kind,
    };
  });
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_]+)_(?!_)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .trim();
}

function sentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  try {
    const segmenter = new Intl.Segmenter("nb", { granularity: "sentence" });
    return Array.from(segmenter.segment(clean), (part) => part.segment.trim()).filter(Boolean);
  } catch {
    return clean.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((part) => part.trim()).filter(Boolean) ?? [clean];
  }
}

function formatDate(value: string | null): string {
  if (!value) return "aldri";
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function downloadText(filename: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("document.md");
  const [retention, setRetention] = useState<Retention>("1w");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [sourceExpiresAt, setSourceExpiresAt] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<{ blockId: string; quote: string } | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const blocks = useMemo(() => splitMarkdownBlocks(source), [source]);
  const openBlock = blocks.find((block) => block.id === openBlockId) ?? blocks[0] ?? null;
  const reviewedSet = useMemo(() => new Set(reviewed), [reviewed]);
  const progress = blocks.length ? Math.round((reviewed.length / blocks.length) * 100) : 0;
  const agentUrl = reviewId && typeof window !== "undefined" ? `${window.location.origin}/api/reviews/${reviewId}` : "";

  const loadExisting = useCallback(async (id: string) => {
    setLoadingExisting(true);
    setError(null);
    try {
      const response = await fetch(`/api/reviews/${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Kunne ikke åpne review-lenken.");
      const data = await response.json() as LoadedReview;
      setReviewId(data.id);
      setFilename(data.filename);
      setRetention(data.retention);
      setSourceExpiresAt(data.sourceExpiresAt);
      setAnnotations(data.annotations ?? []);
      setReviewed(data.reviewedBlockIds ?? []);
      setSource(data.source ?? "");
      const token = localStorage.getItem(`markdown-review:${data.id}:editToken`);
      setEditToken(token);
      setReadOnly(!token);
      const parsed = data.source ? splitMarkdownBlocks(data.source) : [];
      setOpenBlockId(parsed[0]?.id ?? null);
      if (!data.sourceAvailable) {
        setError("Kildedokumentet er utløpt og er ikke lenger tilgjengelig. Errata er beholdt.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke laste review.");
    } finally {
      setLoadingExisting(false);
    }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("review");
    if (id) void loadExisting(id);
  }, [loadExisting]);

  const saveNow = useCallback(async () => {
    if (!reviewId || !editToken || readOnly) return true;
    setSaveState("saving");
    try {
      const response = await fetch(`/api/reviews/${reviewId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-edit-token": editToken },
        body: JSON.stringify({ annotations, reviewedBlockIds: reviewed }),
      });
      if (!response.ok) throw new Error("Lagring feilet");
      setSaveState("saved");
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  }, [reviewId, editToken, readOnly, annotations, reviewed]);

  useEffect(() => {
    if (!reviewId || !editToken || readOnly) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => void saveNow(), 650);
    return () => window.clearTimeout(timer);
  }, [annotations, reviewed, reviewId, editToken, readOnly, saveNow]);

  async function ingestFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".md") && file.type !== "text/markdown" && file.type !== "text/plain") {
      setError("Velg en Markdown-fil (.md).");
      return;
    }
    const text = await file.text();
    setSource(text);
    setFilename(file.name || "document.md");
    setReviewId(null);
    setEditToken(null);
    setAnnotations([]);
    setReviewed([]);
    setReadOnly(false);
    setError(null);
  }

  async function createReview() {
    if (!source.trim()) {
      setError("Legg inn et Markdown-dokument først.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, filename, retention }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunne ikke opprette review.");
      setReviewId(data.id);
      setEditToken(data.editToken);
      setSourceExpiresAt(data.sourceExpiresAt);
      localStorage.setItem(`markdown-review:${data.id}:editToken`, data.editToken);
      window.history.replaceState({}, "", `/?review=${data.id}`);
      const parsed = splitMarkdownBlocks(source);
      setOpenBlockId(parsed[0]?.id ?? null);
      setSaveState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke starte review.");
    } finally {
      setBusy(false);
    }
  }

  function toggleReviewed(blockId: string) {
    if (readOnly) return;
    setReviewed((current) => current.includes(blockId)
      ? current.filter((id) => id !== blockId)
      : [...current, blockId]);
  }

  function addAnnotation() {
    if (!selectedQuote || !comment.trim() || readOnly) return;
    setAnnotations((current) => [...current, {
      id: crypto.randomUUID(),
      blockId: selectedQuote.blockId,
      quote: selectedQuote.quote,
      comment: comment.trim(),
      createdAt: new Date().toISOString(),
    }]);
    setComment("");
    setSelectedQuote(null);
  }

  async function finishReview() {
    const saved = await saveNow();
    if (!saved || !agentUrl) return;
    await navigator.clipboard.writeText(agentUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2400);
  }

  function resetApp() {
    setSource("");
    setFilename("document.md");
    setReviewId(null);
    setEditToken(null);
    setSourceExpiresAt(null);
    setAnnotations([]);
    setReviewed([]);
    setOpenBlockId(null);
    setSelectedQuote(null);
    setComment("");
    setError(null);
    setReadOnly(false);
    window.history.replaceState({}, "", "/");
  }

  if (loadingExisting) {
    return <main className="loading-screen"><div className="spinner" /><p>Åpner review…</p></main>;
  }

  if (!reviewId) {
    return (
      <main className="landing-shell">
        <section className="intro-card">
          <div className="brand-row"><span className="brand-mark">MR</span><span>Markdown Review</span></div>
          <p className="eyebrow">Fokusert dokumentgjennomgang</p>
          <h1>Les én del om gangen.<br />Kommenter akkurat der det skurrer.</h1>
          <p className="lede">Last inn Markdown, gå gjennom dokumentet blokk for blokk og bygg strukturert errata som kan deles direkte med en agent.</p>

          <div
            className="dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) void ingestFile(file);
            }}
            onClick={() => fileInput.current?.click()}
          >
            <input ref={fileInput} hidden type="file" accept=".md,text/markdown,text/plain" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void ingestFile(file);
            }} />
            <span className="drop-icon">↓</span>
            <strong>{source ? filename : "Slipp Markdown-filen her"}</strong>
            <span>{source ? `${blocks.length} deler oppdaget · klikk for å bytte fil` : "eller klikk for å velge .md"}</span>
          </div>

          <div className="or"><span>eller lim inn Markdown</span></div>
          <textarea
            className="source-input"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setFilename("pasted-document.md");
            }}
            placeholder="# Rapport\n\nLim inn dokumentet her…"
          />

          <div className="start-row">
            <label className="retention-control">
              <span>Behold kildefilen</span>
              <select value={retention} onChange={(event) => setRetention(event.target.value as Retention)}>
                <option value="1d">1 dag</option>
                <option value="1w">1 uke</option>
                <option value="1m">1 måned</option>
                <option value="never">Aldri</option>
              </select>
            </label>
            <button className="primary-button" disabled={!source.trim() || busy} onClick={() => void createReview()}>
              {busy ? "Oppretter…" : "Start gjennomgang →"}
            </button>
          </div>
          {error && <p className="error-banner">{error}</p>}
          <p className="privacy-note">Errata beholdes etter at kildedokumentet er slettet. Delingslenken fungerer som en capability-lenke.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="review-shell">
      <header className="topbar">
        <div className="topbar-brand"><span className="brand-mark small">MR</span><div><strong>{filename}</strong><span>{readOnly ? "Visning" : saveState === "saving" ? "Lagrer…" : saveState === "error" ? "Lagringsfeil" : "Lagret"}</span></div></div>
        <div className="top-actions">
          <button className="ghost-button" onClick={() => downloadText(`${reviewId}-errata.json`, JSON.stringify({ reviewId, annotations, reviewedBlockIds: reviewed }, null, 2), "application/json")}>Eksporter errata</button>
          {source && <button className="ghost-button" onClick={() => downloadText(filename, source, "text/markdown")}>Last ned original</button>}
          {!readOnly && <button className="primary-button compact" onClick={() => void finishReview()}>{copied ? "Agentlenke kopiert ✓" : "Fullfør · kopier agentlenke"}</button>}
        </div>
      </header>

      {error && <div className="review-warning">{error}</div>}

      <div className="review-grid">
        <aside className="sidebar">
          <div className="progress-panel">
            <div className="progress-copy"><span>Fremdrift</span><strong>{reviewed.length}/{blocks.length}</strong></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <small>{annotations.length} {annotations.length === 1 ? "kommentar" : "kommentarer"}</small>
          </div>

          <nav className="block-list" aria-label="Dokumentdeler">
            {blocks.map((block, index) => {
              const done = reviewedSet.has(block.id);
              const count = annotations.filter((annotation) => annotation.blockId === block.id).length;
              return (
                <button key={block.id} className={`block-tab ${openBlock?.id === block.id ? "active" : ""} ${done ? "done" : ""}`} onClick={() => setOpenBlockId(block.id)}>
                  <span className="block-index">{done ? "✓" : String(index + 1).padStart(2, "0")}</span>
                  <span className="block-tab-copy"><strong>{block.title}</strong><small>{count ? `${count} kommentar${count === 1 ? "" : "er"}` : block.kind === "code" ? "Kode" : "Ikke gjennomgått"}</small></span>
                </button>
              );
            })}
          </nav>

          <div className="retention-note">
            <span>Kilde lagres</span>
            <strong>{retentionLabels[retention]}</strong>
            <small>{sourceExpiresAt ? `Til ${formatDate(sourceExpiresAt)}` : "Ingen automatisk sletting"}</small>
          </div>
          <button className="new-review" onClick={resetApp}>+ Nytt dokument</button>
        </aside>

        <section className="reading-pane">
          {openBlock ? (
            <article className="reading-card">
              <div className="reading-meta"><span>Del {blocks.findIndex((block) => block.id === openBlock.id) + 1} av {blocks.length}</span><span>{openBlock.kind === "prose" ? "Klikk en setning for å kommentere" : "Markdown-visning"}</span></div>

              {openBlock.kind === "prose" || openBlock.kind === "heading" ? (
                <div className={`sentence-view ${openBlock.kind === "heading" ? "heading-view" : ""}`}>
                  {sentences(stripInlineMarkdown(openBlock.raw)).map((sentence, index) => {
                    const count = annotations.filter((annotation) => annotation.blockId === openBlock.id && annotation.quote === sentence).length;
                    return (
                      <button
                        key={`${index}-${sentence.slice(0, 20)}`}
                        className={`sentence ${count ? "annotated" : ""} ${selectedQuote?.blockId === openBlock.id && selectedQuote.quote === sentence ? "selected" : ""}`}
                        onClick={() => !readOnly && setSelectedQuote({ blockId: openBlock.id, quote: sentence })}
                      >
                        {sentence}{count > 0 && <sup>{count}</sup>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="markdown-render"><ReactMarkdown remarkPlugins={[remarkGfm]}>{openBlock.raw}</ReactMarkdown></div>
              )}

              {!readOnly && openBlock.kind !== "code" && openBlock.kind !== "heading" && openBlock.kind !== "prose" && (
                <button className="comment-block-button" onClick={() => setSelectedQuote({ blockId: openBlock.id, quote: stripInlineMarkdown(openBlock.raw) })}>Kommenter hele blokken</button>
              )}

              <div className="review-controls">
                <label className={`review-check ${reviewedSet.has(openBlock.id) ? "checked" : ""}`}>
                  <input type="checkbox" checked={reviewedSet.has(openBlock.id)} disabled={readOnly} onChange={() => toggleReviewed(openBlock.id)} />
                  <span className="check-box">✓</span>
                  <span>Gjennomgått</span>
                </label>
                <div className="nav-buttons">
                  <button disabled={blocks.findIndex((block) => block.id === openBlock.id) <= 0} onClick={() => {
                    const i = blocks.findIndex((block) => block.id === openBlock.id);
                    setOpenBlockId(blocks[i - 1]?.id ?? openBlock.id);
                  }}>← Forrige</button>
                  <button disabled={blocks.findIndex((block) => block.id === openBlock.id) >= blocks.length - 1} onClick={() => {
                    const i = blocks.findIndex((block) => block.id === openBlock.id);
                    setOpenBlockId(blocks[i + 1]?.id ?? openBlock.id);
                  }}>Neste →</button>
                </div>
              </div>
            </article>
          ) : (
            <article className="reading-card empty-source"><h2>Kilden er ikke lenger tilgjengelig</h2><p>Errata under er fortsatt bevart og kan deles med agentlenken.</p></article>
          )}

          {selectedQuote && !readOnly && (
            <section className="composer">
              <div className="composer-quote"><span>Kommenterer</span><q>{selectedQuote.quote}</q></div>
              <textarea autoFocus value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Hva bør endres, undersøkes eller presiseres?" onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") addAnnotation();
              }} />
              <div className="composer-actions"><button onClick={() => { setSelectedQuote(null); setComment(""); }}>Avbryt</button><button className="primary-button compact" disabled={!comment.trim()} onClick={addAnnotation}>Lagre kommentar</button></div>
            </section>
          )}

          <section className="errata-panel">
            <div className="section-heading"><div><span className="eyebrow">Errata</span><h2>Kommentarer fra gjennomgangen</h2></div><span className="count-pill">{annotations.length}</span></div>
            {annotations.length === 0 ? (
              <p className="empty-state">Ingen kommentarer ennå. Klikk på en setning i dokumentet for å legge til én.</p>
            ) : (
              <div className="annotation-list">
                {annotations.map((annotation, index) => (
                  <article className="annotation-card" key={annotation.id}>
                    <div className="annotation-number">{String(index + 1).padStart(2, "0")}</div>
                    <div><q>{annotation.quote}</q><p>{annotation.comment}</p><small>{formatDate(annotation.createdAt)}</small></div>
                    {!readOnly && <button className="delete-comment" aria-label="Slett kommentar" onClick={() => setAnnotations((current) => current.filter((item) => item.id !== annotation.id))}>×</button>}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="agent-panel">
            <div><span className="eyebrow">Agent handoff</span><h2>Én lenke inneholder reviewet</h2><p>API-et returnerer original Markdown så lenge retention tillater det, pluss permanent errata og review-status.</p></div>
            <div className="agent-link"><code>{agentUrl}</code><button onClick={async () => { await navigator.clipboard.writeText(agentUrl); setCopied(true); window.setTimeout(() => setCopied(false), 2400); }}>{copied ? "Kopiert" : "Kopier"}</button></div>
          </section>
        </section>
      </div>
    </main>
  );
}
